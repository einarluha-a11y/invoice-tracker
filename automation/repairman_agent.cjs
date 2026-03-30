#!/usr/bin/env node
/**
 * 🛠️ UNIVERSAL REPAIRMAN AGENT
 *
 * Scans Firestore for invoices based on a date range and identifies anomalies:
 *   - Missing or zero amount
 *   - Missing File (fileUrl null or body_text)
 *   - Missing VAT & Registration
 *   - Missing Line Items / Description
 *   - Stuck in DRAFT / NEEDS_REVIEW
 *
 * If --fix is passed, it automatically:
 *   1. Deletes the broken records from Firestore
 *   2. Connects to the respective IMAP inboxes
 *   3. Removes \Seen from those emails so the IMAP daemon re-downloads them
 *
 * Usage:
 *   node repairman_agent.cjs --date 2026-03-25
 *   node repairman_agent.cjs --since 2026-03-23 --until 2026-03-30 --fix
 */

require('dotenv').config({ path: __dirname + '/.env' });
const imaps = require('imap-simple');
const { admin, db } = require('./core/firebase.cjs');

const args     = process.argv.slice(2);
const getArg   = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const hasFlag  = (n) => args.includes(n);

const dryRun    = !hasFlag('--fix');
const skipImap  = hasFlag('--skip-imap');
const dateArg   = getArg('--date');
let sinceArg    = getArg('--since');
let untilArg    = getArg('--until');

if (dateArg) {
    sinceArg = dateArg;
    untilArg = dateArg;
}

const IMAP_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function toImapDate(d) {
    return `${String(d.getDate()).padStart(2,'0')}-${IMAP_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

// ─── Step 1: Query Firestore & Apply Detection Logic ──────────────────────────

async function findBadInvoices() {
    let q = db.collection('invoices').orderBy('createdAt', 'desc').limit(5000);
    
    if (sinceArg) q = q.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(sinceArg)));
    if (untilArg) {
        // Expand until end of day
        q = q.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(new Date(untilArg + 'T23:59:59.999Z')));
    }

    const snap = await q.get();
    const badInvoices = [];

    for (const doc of snap.docs) {
        const d = doc.data();

        const hasMissingFile   = !d.fileUrl || d.fileUrl === 'BODY_TEXT_NO_ATTACHMENT';
        const hasZeroAmount    = !d.amount || Number(d.amount) === 0;
        const isMissingIdentity = (!d.supplierVat || d.supplierVat === 'Not_Found') &&
                                  (!d.supplierRegistration || d.supplierRegistration === 'Not_Found');

        // NEEDS_REVIEW is a valid human-review status when the file exists but VAT/Reg
        // is absent from the document. Deleting such records causes an infinite re-queue
        // loop because the original PDF won't have that information either.
        // Only flag NEEDS_REVIEW/DRAFT as "stuck" when there is ALSO no file.
        const isStuck = (d.status === 'NEEDS_REVIEW' || d.status === 'DRAFT') && hasMissingFile;

        // Missing line items alone is not a reliable reason for deletion: many legitimate
        // invoices from small vendors genuinely have no itemisation. Re-processing won't
        // produce line items if the PDF doesn't contain them — it only creates churn.
        // Include it only as additional context when the record is already bad for another reason.

        let reasons = [];
        if (hasMissingFile)    reasons.push('Missing File');
        if (hasZeroAmount)     reasons.push('Zero Amount');
        if (isMissingIdentity && hasMissingFile) reasons.push('Missing VAT & RegNo');
        if (isStuck)           reasons.push(`Stuck in ${d.status}`);

        if (reasons.length > 0) {
            badInvoices.push({ id: doc.id, data: d, reason: reasons.join(' + ') });
        }
    }
    return badInvoices;
}

// ─── Step 2: Get IMAP Config ──────────────────────────────────────────────────

async function getImapConfig(companyId) {
    const doc = await db.collection('companies').doc(companyId).get();
    if (doc.exists) {
        const d = doc.data();
        const host = (d.imapHost || '').trim();
        const user = (d.imapUser || '').trim();
        const pass = (d.imapPassword || '').trim();
        if (host && user && pass) {
            return { user, password: pass, host, port: d.imapPort || 993 };
        }
    }
    if (process.env.IMAP_USER && process.env.IMAP_PASSWORD && process.env.IMAP_HOST) {
        return {
            user:     process.env.IMAP_USER.trim(),
            password: process.env.IMAP_PASSWORD.trim(),
            host:     process.env.IMAP_HOST.trim(),
            port:     parseInt(process.env.IMAP_PORT || '993', 10),
        };
    }
    return null;
}

// ─── Step 3: Reset \Seen Flags with Throttling ────────────────────────────────

async function resetSeenFlags(imapConf, sinceDate, untilDate, label) {
    const config = {
        imap: {
            user:     imapConf.user,
            password: imapConf.password,
            host:     imapConf.host,
            port:     imapConf.port,
            tls:      process.env.IMAP_TLS !== 'false',
            authTimeout: 30000,
            connTimeout: 30000,
            tlsOptions: { rejectUnauthorized: false },
        }
    };

    console.log(`  [IMAP] Connecting to ${imapConf.host} as ${imapConf.user}...`);
    let connection;
    const MAX_CONNECT_ATTEMPTS = 3;
    
    for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
        try {
            connection = await imaps.connect(config);
            await connection.openBox('INBOX');
            break; 
        } catch (err) {
            const isRateLimit = /rate.limit|too many|429|login.wait/i.test(err.message);
            if (isRateLimit && attempt < MAX_CONNECT_ATTEMPTS) {
                const waitSec = attempt * 30; 
                console.warn(`  [IMAP] ⚠️  Rate limited (attempt ${attempt}/${MAX_CONNECT_ATTEMPTS}). Waiting ${waitSec}s...`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
            } else {
                console.error(`  [IMAP] ❌ Connection failed: ${err.message}`);
                return 0;
            }
        }
    }
    if (!connection) return 0;

    const sinceImap = toImapDate(sinceDate);
    const beforeDate = new Date(untilDate);
    beforeDate.setDate(beforeDate.getDate() + 1);
    const beforeImap = toImapDate(beforeDate);

    const criteria = [['SEEN'], ['SINCE', sinceImap], ['BEFORE', beforeImap]];
    console.log(`  [IMAP] Searching SEEN messages from ${sinceImap} to ${beforeImap}...`);

    let messages = [];
    try {
        messages = await connection.search(criteria, { bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)'], markSeen: false });
    } catch (err) {
        console.error(`  [IMAP] ❌ Search failed: ${err.message}`);
        connection.end();
        return 0;
    }

    console.log(`  [IMAP] Found ${messages.length} SEEN message(s).`);
    if (messages.length === 0) {
        connection.end();
        return 0;
    }

    if (dryRun) {
        console.log(`  [IMAP] [DRY RUN] Would remove \\Seen from ${messages.length} messages.`);
        connection.end();
        return messages.length;
    }

    const uids = messages.map(m => m.attributes.uid);
    const uidList = uids.join(',');

    try {
        await new Promise((resolve, reject) => {
            connection.imap._enqueue(`UID STORE ${uidList} -FLAGS.SILENT (\\Seen)`, (err) => {
                if (err) reject(err); else resolve();
            });
        });
        console.log(`  [IMAP] ✅ Removed \\Seen from ${uids.length} messages.`);
    } catch (err) {
        console.error(`  [IMAP] ❌ UID STORE failed: ${err.message}. Emails might not redownload.`);
    }

    connection.end();
    return uids.length;
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

(async () => {
    console.log('─────────────────────────────────────────────────');
    console.log('🛠️  UNIVERSAL REPAIRMAN AGENT');
    console.log(`Date Range: ${sinceArg || 'Start'} to ${untilArg || 'End'}`);
    if (dryRun) console.log('🔍 DRY RUN (Pass --fix to execute destruction & recovery)');
    else console.log('🔥 LIVE EXECUTION');
    console.log('─────────────────────────────────────────────────\n');

    console.log('Step 1: Analyzing Firestore...');
    const badInvoices = await findBadInvoices();

    if (badInvoices.length === 0) {
        console.log('✅ All invoices in this range look healthy. No repairs needed.');
        process.exit(0);
    }

    console.log(`Found ${badInvoices.length} problematic invoice(s):\n`);
    console.log(`${'Firestore ID'.padEnd(22)} ${'Vendor'.padEnd(30)} ${'Created'.padEnd(12)} Reason`);
    console.log('─'.repeat(90));

    const byCompany = {};
    for (const item of badInvoices) {
        const { id, data, reason } = item;
        const cid = data.companyId || '__default__';
        
        if (!byCompany[cid]) byCompany[cid] = { records: [], earliest: null, latest: null };
        const ts = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : new Date();
        
        if (!byCompany[cid].earliest || ts < byCompany[cid].earliest) byCompany[cid].earliest = ts;
        if (!byCompany[cid].latest   || ts > byCompany[cid].latest)   byCompany[cid].latest   = ts;
        byCompany[cid].records.push(item);

        const vendor = (data.vendorName || 'UNKNOWN').slice(0, 28).padEnd(30);
        const created = ts.toISOString().slice(0, 10).padEnd(12);
        console.log(`${id.padEnd(22)} ${vendor} ${created} ⚠️ ${reason}`);
    }

    console.log('\n');
    
    // Step 2: Reset IMAP \Seen Flags
    if (skipImap) {
        console.log('Step 2: Skipping IMAP recovery (--skip-imap passed).');
    } else {
        console.log('Step 2: Syncing with IMAP Servers...');
        for (const [companyId, info] of Object.entries(byCompany)) {
            const realId = companyId === '__default__' ? null : companyId;
            console.log(`\n▶ Company: ${realId || 'Default Env'} (${info.records.length} bad invoices)`);

            const imapConf = await getImapConfig(realId);
            if (!imapConf) {
                console.warn(`  [IMAP] ⚠️ No IMAP config. Cannot auto-recover corresponding emails.`);
                continue;
            }

            // Pad the search range by ±1 day just in case Timezones shift dates
            const startD = new Date(info.earliest.getTime() - 86400000);
            const endD   = new Date(info.latest.getTime() + 86400000);
            await resetSeenFlags(imapConf, startD, endD, realId);
        }
    }

    console.log('\nStep 3: Database Cleanup');
    if (!dryRun) {
        console.log(`Deleting ${badInvoices.length} records from Firestore...`);
        const BATCH_SIZE = 400;
        let deleted = 0;
        for (let i = 0; i < badInvoices.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const chunk = badInvoices.slice(i, i + BATCH_SIZE);
            for (const { id } of chunk) {
                batch.delete(db.collection('invoices').doc(id));
            }
            await batch.commit();
            deleted += chunk.length;
            console.log(`  ✅ Batch ${Math.ceil((i + 1) / BATCH_SIZE)}: deleted ${chunk.length} records (${deleted}/${badInvoices.length} total)`);
        }
        console.log(`✅ Deleted ${deleted} records successfully.`);
    } else {
        console.log(`[DRY RUN] Would delete ${badInvoices.length} records.`);
    }

    console.log('\n─────────────────────────────────────────────────');
    if (dryRun) console.log('Run with --fix to apply repairs.');
    else console.log('✅ Repair sequence complete! The primary daemon will re-process them soon.');
    process.exit(0);

})();
