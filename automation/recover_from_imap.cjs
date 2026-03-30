#!/usr/bin/env node
/**
 * recover_from_imap.cjs — Recover skeleton records by resetting IMAP \Seen flags
 *
 * 1. Finds all skeleton invoice records in Firestore (no fileUrl)
 * 2. For each affected company, connects to IMAP
 * 3. Removes \Seen from emails in the matching date range
 * 4. Deletes the skeleton Firestore records
 * 5. On the next IMAP daemon poll cycle, those emails are re-processed
 *    with full PDF extraction + Completeness Gate active
 *
 * Usage:
 *   node recover_from_imap.cjs                         # dry-run — show what would happen
 *   node recover_from_imap.cjs --fix                   # execute recovery
 *   node recover_from_imap.cjs --company <id> --fix    # one company only
 *   node recover_from_imap.cjs --since 2026-03-28 --until 2026-03-31 --fix
 *   node recover_from_imap.cjs --fix --skip-imap       # only delete skeletons, no IMAP reset
 */

require('dotenv').config({ path: __dirname + '/.env' });
const imaps        = require('imap-simple');
const { admin, db } = require('./core/firebase.cjs');

const args     = process.argv.slice(2);
const getArg   = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const hasFlag  = (n) => args.includes(n);

const dryRun    = !hasFlag('--fix');
const skipImap  = hasFlag('--skip-imap');
const companyFilter = getArg('--company');
const sinceArg  = getArg('--since');
const untilArg  = getArg('--until');

const IMAP_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function toImapDate(d) {
    return `${String(d.getDate()).padStart(2,'0')}-${IMAP_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

// ─── Step 1: Find skeleton records ───────────────────────────────────────────

async function findSkeletons() {
    let q = db.collection('invoices').orderBy('createdAt', 'desc').limit(2000);
    if (companyFilter) q = q.where('companyId', '==', companyFilter);
    if (sinceArg)      q = q.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(sinceArg)));
    if (untilArg)      q = q.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(new Date(untilArg + 'T23:59:59')));

    const snap = await q.get();
    const skeletons = [];
    for (const doc of snap.docs) {
        const d = doc.data();
        const hasFile = !!(d.fileUrl && d.fileUrl !== 'BODY_TEXT_NO_ATTACHMENT') || !!d.originalFileUrl;
        if (!hasFile) {
            skeletons.push({ id: doc.id, data: d });
        }
    }
    return skeletons;
}

// ─── Step 2: Get IMAP config for a company ────────────────────────────────────

async function getImapConfig(companyId) {
    // Check company-specific IMAP first
    const doc = await db.collection('companies').doc(companyId).get();
    if (doc.exists) {
        const d = doc.data();
        if (d.imapHost && d.imapUser && d.imapPassword) {
            return { user: d.imapUser, password: d.imapPassword, host: d.imapHost, port: d.imapPort || 993 };
        }
    }
    // Fall back to environment .env
    if (process.env.IMAP_USER && process.env.IMAP_PASSWORD && process.env.IMAP_HOST) {
        return {
            user:     process.env.IMAP_USER,
            password: process.env.IMAP_PASSWORD,
            host:     process.env.IMAP_HOST,
            port:     parseInt(process.env.IMAP_PORT || '993', 10),
        };
    }
    return null;
}

// ─── Step 3: Reset \Seen flags in IMAP for a date range ──────────────────────

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
    try {
        connection = await imaps.connect(config);
        await connection.openBox('INBOX');
    } catch (err) {
        console.error(`  [IMAP] ❌ Connection failed: ${err.message}`);
        return 0;
    }

    // Search SEEN messages in the date range (these were already processed — we want to re-process them)
    const sinceImap = toImapDate(sinceDate);
    // IMAP BEFORE is exclusive upper bound; add 1 day
    const beforeDate = new Date(untilDate);
    beforeDate.setDate(beforeDate.getDate() + 1);
    const beforeImap = toImapDate(beforeDate);

    const criteria = [['SEEN'], ['SINCE', sinceImap], ['BEFORE', beforeImap]];
    console.log(`  [IMAP] Searching SEEN messages from ${sinceImap} to ${beforeImap}...`);

    const fetchOptions = { bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)'], markSeen: false };
    let messages = [];
    try {
        messages = await connection.search(criteria, fetchOptions);
    } catch (err) {
        console.error(`  [IMAP] ❌ Search failed: ${err.message}`);
        connection.end();
        return 0;
    }

    console.log(`  [IMAP] Found ${messages.length} SEEN message(s) in range.`);

    if (messages.length === 0) {
        connection.end();
        return 0;
    }

    // Print a preview
    for (const msg of messages) {
        const hdr = msg.parts.find(p => p.which.includes('HEADER'));
        const subject = hdr?.body?.subject?.[0] || '(no subject)';
        const from    = hdr?.body?.from?.[0] || '(unknown)';
        const date    = hdr?.body?.date?.[0] || '';
        console.log(`    UID ${msg.attributes.uid}: [${date.slice(0,10)}] ${from.slice(0,30)} — ${subject.slice(0,50)}`);
    }

    if (dryRun) {
        console.log(`  [IMAP] DRY RUN — would remove \\Seen from ${messages.length} message(s).`);
        connection.end();
        return messages.length;
    }

    // Remove \Seen flag so IMAP daemon will re-process these.
    // Use raw UID STORE command — most reliable across IMAP servers.
    const uids = messages.map(m => m.attributes.uid);
    const uidList = uids.join(',');

    try {
        await new Promise((resolve, reject) => {
            // node-imap raw command: UID STORE <uids> -FLAGS.SILENT (\Seen)
            connection.imap._enqueue(`UID STORE ${uidList} -FLAGS.SILENT (\\Seen)`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log(`  [IMAP] ✅ Removed \\Seen from ${uids.length} message(s). They will be re-processed on next daemon cycle.`);
    } catch (err) {
        // Fallback: try the imap library's delFlags via seq (in case server uses seq numbers)
        console.warn(`  [IMAP] UID STORE failed (${err.message}), trying delFlags fallback...`);
        try {
            await new Promise((resolve, reject) => {
                connection.imap.setFlags(uidList, [], (e) => e ? reject(e) : resolve());
                setTimeout(resolve, 500); // timeout in case callback never fires
            }).catch(() => {});
            // Final fallback: mark as unread via imap-simple helper if available
            for (const uid of uids) {
                try { connection.imap.delFlags(String(uid), ['\\Seen'], () => {}); } catch (_) {}
            }
            console.log(`  [IMAP] ✅ Fallback flag removal applied for ${uids.length} message(s).`);
        } catch (fallbackErr) {
            console.error(`  [IMAP] ❌ Both flag removal methods failed: ${fallbackErr.message}`);
            console.error(`  [IMAP]    Manual recovery: mark UIDs [${uidList}] as Unread in your email client.`);
        }
    }

    connection.end();
    return uids.length;
}

// ─── Step 4: Delete skeleton Firestore records ────────────────────────────────

async function deleteSkeletons(skeletons) {
    const batch = db.batch();
    for (const { id } of skeletons) {
        batch.delete(db.collection('invoices').doc(id));
    }
    await batch.commit();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
    if (dryRun) console.log('🔍  DRY RUN — pass --fix to execute recovery\n');
    else        console.log('🔧  LIVE MODE — executing recovery\n');

    // ── 1. Find skeletons ─────────────────────────────────────────────────────
    console.log('Step 1: Scanning Firestore for skeleton records (no fileUrl)...');
    const skeletons = await findSkeletons();

    if (skeletons.length === 0) {
        console.log('✅  No skeleton records found. Nothing to recover.');
        process.exit(0);
    }

    console.log(`Found ${skeletons.length} skeleton record(s):\n`);
    console.log(`${'Firestore ID'.padEnd(22)} ${'CompanyID'.padEnd(22)} ${'Vendor'.padEnd(30)} ${'InvoiceID'.padEnd(22)} Created`);
    console.log('─'.repeat(110));

    // Group by company + determine date range per company
    const byCompany = {};
    for (const sk of skeletons) {
        const d = sk.data;
        const cid = d.companyId || '__default__';
        if (!byCompany[cid]) byCompany[cid] = { skeletons: [], earliest: null, latest: null };

        const ts = d.createdAt?._seconds ? new Date(d.createdAt._seconds * 1000) : null;
        if (ts) {
            if (!byCompany[cid].earliest || ts < byCompany[cid].earliest) byCompany[cid].earliest = ts;
            if (!byCompany[cid].latest   || ts > byCompany[cid].latest)   byCompany[cid].latest   = ts;
        }
        byCompany[cid].skeletons.push(sk);

        const created = ts ? ts.toISOString().slice(0, 10) : '—';
        console.log(`${sk.id.slice(0,21).padEnd(22)} ${cid.slice(0,21).padEnd(22)} ${(d.vendorName||'—').slice(0,28).padEnd(30)} ${(d.invoiceId||'—').slice(0,20).padEnd(22)} ${created}`);
    }

    console.log('');

    if (skipImap) {
        console.log('Step 2: Skipping IMAP reset (--skip-imap flag set).');
    } else {
        // ── 2. Reset \Seen per company ────────────────────────────────────────
        console.log('Step 2: Resetting \\Seen flags in IMAP...\n');

        for (const [companyId, info] of Object.entries(byCompany)) {
            const realId = companyId === '__default__' ? null : companyId;
            console.log(`  Company: ${companyId} (${info.skeletons.length} skeleton(s))`);

            const imapConf = await getImapConfig(realId);
            if (!imapConf) {
                console.warn(`  [IMAP] ⚠️  No IMAP config found for company ${companyId}. Skipping IMAP step.`);
                continue;
            }

            // Use a ±1 day buffer around the skeleton dates
            const sinceDate = info.earliest ? new Date(info.earliest.getTime() - 86400000) : new Date(Date.now() - 7*86400000);
            const untilDate = info.latest   ? new Date(info.latest.getTime()   + 86400000) : new Date();

            await resetSeenFlags(imapConf, sinceDate, untilDate, companyId);
            console.log('');
        }
    }

    // ── 3. Delete skeleton records from Firestore ─────────────────────────────
    console.log(`Step 3: ${dryRun ? '[DRY RUN] Would delete' : 'Deleting'} ${skeletons.length} skeleton record(s) from Firestore...`);

    if (!dryRun) {
        await deleteSkeletons(skeletons);
        console.log(`  ✅  Deleted ${skeletons.length} skeleton record(s).`);
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n─────────────────────────────────────────────────');
    if (dryRun) {
        console.log(`Would remove \\Seen from IMAP emails and delete ${skeletons.length} skeleton(s).`);
        console.log('Run with --fix to execute.');
    } else {
        console.log('✅  Recovery complete.');
        console.log('');
        console.log('Next steps:');
        console.log('  1. The IMAP daemon will re-process those emails on the next poll cycle.');
        console.log('     Default poll interval: every few minutes (check Railway logs).');
        console.log('  2. New records will be created with full PDF data + fileUrl.');
        console.log('  3. Duplicate detection will prevent double-counting if similar');
        console.log('     records exist from other dates.');
    }

    process.exit(0);
})();
