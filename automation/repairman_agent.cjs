#!/usr/bin/env node
/**
 * РЕМОНТНИК (Repairman Agent) v3
 *
 * Key principle: NEVER delete invoice records. Always UPDATE in place.
 * If manuallyEdited=true, only fill empty fields — never overwrite manual corrections.
 *
 * Modes:
 *   --mode full       (default) Find all anomalies + re-extract from original file
 *   --mode skeletons  Find records without fileUrl
 *   --mode statuses   Find records with problematic statuses
 *   --mode audit      Sweep ALL invoices: fix statuses (Pending→Overdue, check Paid), normalize vendor names
 *
 * Options:
 *   --fix             Execute repairs (default is dry-run)
 *   --date YYYY-MM-DD Single date
 *   --since / --until Date range
 *   --company <id>    Filter by company
 *   --skip-imap       Skip IMAP file retrieval
 *
 * Usage:
 *   node repairman_agent.cjs                                    # dry-run, full mode
 *   node repairman_agent.cjs --mode skeletons --fix
 *   node repairman_agent.cjs --since 2026-03-23 --until 2026-03-30 --fix
 */

// Health check — ensure system is ready before running repairs
try {
    require('./health_check.cjs');
} catch (e) {
    console.error('[Repairman] ❌ Health check failed. Fix issues before running repairs.');
    process.exit(1);
}

require('dotenv').config({ path: __dirname + '/.env' });
const https = require('https');
const http = require('http');
const { admin, db, bucket } = require('./core/firebase.cjs');
const {
    logRepair, incrementRepairAttempts, getRepairAttempts, markRepairPending,
    getStagedDocument,
} = require('./core/staging.cjs');
const { cleanNum } = require('./core/utils.cjs');

// ─── CLI Arguments ───────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const getArg   = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : null; };
const hasFlag  = (n) => args.includes(n);

const mode          = getArg('--mode') || 'full';
const dryRun        = !hasFlag('--fix');
const skipImap      = hasFlag('--skip-imap');
const companyFilter = getArg('--company');
const dateArg       = getArg('--date');
let sinceArg        = getArg('--since');
let untilArg        = getArg('--until');
const invoiceFilter = getArg('--invoice'); // repair specific invoice by Firestore ID

if (dateArg) { sinceArg = dateArg; untilArg = dateArg; }

// ─── Multiuser / Account scoping ─────────────────────────────────────────────
// Pass --account <accountId> or set ACCOUNT_ID env var to scope to a specific
// account's subcollections (accounts/{id}/invoices/, accounts/{id}/companies/).
// Without it, the agent operates on legacy global collections — safe for now
// since the data hasn't been migrated to account subcollections yet.
const accountId = getArg('--account') || process.env.ACCOUNT_ID || null;
if (accountId) console.log(`[Repairman] Scoped to account: ${accountId}`);

function colInvoices() {
    return accountId
        ? db.collection('accounts').doc(accountId).collection('invoices')
        : db.collection('invoices');
}
function colBankTx() {
    return accountId
        ? db.collection('accounts').doc(accountId).collection('bank_transactions')
        : db.collection('bank_transactions');
}

const PROBLEM_STATUSES = [
    'NEEDS_REVIEW', 'Needs Action', 'needs action',
    'OOTEL', 'KARANTIIN', 'Karantine', 'Karantiin', 'Карантин',
    'ANOMALY_DETECTED',
];

const MAX_REPAIR_ATTEMPTS = 2;

const EMPTY_VALUES = ['', 'Not_Found', 'Unknown Vendor', 'UNKNOWN VENDOR', 'Unknown', null, undefined];
function isEmpty(val) {
    if (EMPTY_VALUES.includes(val)) return true;
    if (typeof val === 'number' && isNaN(val)) return true;
    // Note: 0 is a valid value (e.g. taxAmount=0 for VAT 0%), not "empty"
    if (typeof val === 'string' && val.startsWith('Auto-')) return true;
    return false;
}

// ─── Detection Logic ─────────────────────────────────────────────────────────

async function findBadInvoices() {
    if (mode === 'statuses') return findBadStatuses();

    // --invoice ID: force repair specific invoice regardless of problems
    if (invoiceFilter) {
        const doc = await colInvoices().doc(invoiceFilter).get();
        if (!doc.exists) { console.log(`Invoice ${invoiceFilter} not found.`); return []; }
        return [{ id: doc.id, data: doc.data(), reason: 'Forced repair (--invoice)' }];
    }

    let q = colInvoices().orderBy('createdAt', 'desc').limit(5000);
    if (companyFilter) q = q.where('companyId', '==', companyFilter);
    if (sinceArg) q = q.where('createdAt', '>=', admin.firestore.Timestamp.fromDate(new Date(sinceArg)));
    if (untilArg) q = q.where('createdAt', '<=', admin.firestore.Timestamp.fromDate(new Date(untilArg + 'T23:59:59.999Z')));

    const snap = await q.get();
    const bad = [];

    // ── Duplicate detection ─────────────────────────────────────────────────
    const LEGAL_SUFFIXES = /(?:^|\s)(AS|OÜ|OU|OY|AB|GmbH|AG|SIA|UAB|BV|NV|Ltd|LLC|Inc|MTÜ)(?:\s|$|,|\.)/i;
    const isAutoId = (id) => (id || '').startsWith('Auto-');
    const fileBasename = (url) => (url || '').match(/\d+_([^?]+)/)?.[1] || '';

    const seen = new Map(); // key → { id, vendorName }
    const seenByIdAmt = new Map(); // invoiceId+amount+companyId → { id, vendorName }
    const seenByFile = new Map(); // fileBasename+companyId → { id, data }

    for (const doc of snap.docs) {
        const d = doc.data();

        // Key 0: Same source file → duplicate (file re-processed and generated different invoiceIds)
        const basename = fileBasename(d.fileUrl);
        if (basename) {
            const fileKey = `${basename}|${d.companyId || ''}`;
            if (seenByFile.has(fileKey)) {
                const existing = seenByFile.get(fileKey);
                // Prefer the one with real invoiceId over Auto-
                const existingAuto = isAutoId(existing.data.invoiceId);
                const currentAuto = isAutoId(d.invoiceId);
                if (!existingAuto && currentAuto) {
                    bad.push({ id: doc.id, data: d, reason: `Duplicate of ${existing.id} (same file, current has Auto- ID)` });
                    continue;
                } else if (existingAuto && !currentAuto) {
                    bad.push({ id: existing.id, data: existing.data, reason: `Duplicate of ${doc.id} (same file, existing has Auto- ID)` });
                    seenByFile.set(fileKey, { id: doc.id, data: d });
                    continue;
                } else {
                    bad.push({ id: doc.id, data: d, reason: `Duplicate of ${existing.id} (same source file)` });
                    continue;
                }
            }
            seenByFile.set(fileKey, { id: doc.id, data: d });
        }

        // Key 1: exact match (invoiceId + vendorName + amount + companyId)
        const dedupKey = `${(d.invoiceId || '').toLowerCase().trim()}|${(d.vendorName || '').toLowerCase().trim()}|${d.amount || 0}|${d.companyId || ''}`;
        if (seen.has(dedupKey)) {
            bad.push({ id: doc.id, data: d, reason: `Duplicate of ${seen.get(dedupKey).id} (same invoiceId + vendor + amount)` });
            continue;
        }
        seen.set(dedupKey, { id: doc.id, vendorName: d.vendorName });

        // Key 2: invoiceId + amount + companyId (different vendor names — e.g. "oriens.ee" vs "ORIENS OÜ")
        const idAmtKey = `${(d.invoiceId || '').toLowerCase().trim()}|${d.amount || 0}|${d.companyId || ''}`;
        if (seenByIdAmt.has(idAmtKey)) {
            const existing = seenByIdAmt.get(idAmtKey);
            const existingHasSuffix = LEGAL_SUFFIXES.test(existing.vendorName || '');
            const currentHasSuffix = LEGAL_SUFFIXES.test(d.vendorName || '');
            if (existingHasSuffix && !currentHasSuffix) {
                // Existing has legal suffix, current doesn't → current is duplicate
                bad.push({ id: doc.id, data: d, reason: `Duplicate of ${existing.id} (same invoiceId+amount, "${existing.vendorName}" has legal suffix)` });
                continue;
            } else if (!existingHasSuffix && currentHasSuffix) {
                // Current has legal suffix → existing is duplicate, swap
                bad.push({ id: existing.id, data: d, reason: `Duplicate of ${doc.id} (same invoiceId+amount, "${d.vendorName}" has legal suffix)` });
                seenByIdAmt.set(idAmtKey, { id: doc.id, vendorName: d.vendorName });
                continue;
            }
            // Both or neither have suffix — keep both (may be legitimate)
        }
        seenByIdAmt.set(idAmtKey, { id: doc.id, vendorName: d.vendorName });

        const reasons = detectProblems(d);
        if (reasons.length > 0) bad.push({ id: doc.id, data: d, reason: reasons.join(' + ') });
    }
    return bad;
}

function detectProblems(d) {
    // Manually edited invoices are trusted — don't flag for repair
    if (d.manuallyEdited) return [];
    // Paid invoices are done — don't re-extract and risk breaking them
    if (d.status === 'Paid') return [];

    const hasMissingFile   = !d.fileUrl || d.fileUrl === 'BODY_TEXT_NO_ATTACHMENT';
    const hasZeroAmount    = !d.amount || Number(d.amount) === 0;
    const isMissingIdentity = (!d.supplierVat || d.supplierVat === 'Not_Found') &&
                              (!d.supplierRegistration || d.supplierRegistration === 'Not_Found');
    const isStuck = (d.status === 'NEEDS_REVIEW' || d.status === 'DRAFT') && hasMissingFile;

    // Fabricated VAT: country prefix + regCode (hallucinated by Claude)
    const hasFabricatedVat = d.supplierVat && d.supplierRegistration &&
        d.supplierVat.length > 2 && d.supplierVat.slice(2) === d.supplierRegistration;

    // Data quality checks
    const hasUnknownVendor = isEmpty(d.vendorName);
    const hasSameDates = d.dateCreated && d.dueDate && d.dateCreated === d.dueDate;
    const hasMissingDescription = isEmpty(d.description);
    const hasZeroTaxOnTaxableAmount = Number(d.amount) > 0 && Number(d.subtotalAmount) > 0
        && Number(d.taxAmount) === 0 && Number(d.amount) === Number(d.subtotalAmount);
    // Absurd tax: tax >= amount or tax > subtotal (extraction error)
    const hasAbsurdTax = Number(d.taxAmount) > 0 && Number(d.amount) > 0 &&
        (Number(d.taxAmount) >= Number(d.amount) || Number(d.taxAmount) > Number(d.subtotalAmount));
    // Math mismatch removed — sub + tax ≠ total is NORMAL for leasing, mixed-VAT invoices.
    // Buhgalterija cares only about total and tax, not arithmetic consistency.

    const reasons = [];
    if (mode === 'skeletons') {
        if (hasMissingFile) reasons.push('Missing File');
        return reasons;
    }
    if (hasMissingFile)                      reasons.push('Missing File');
    if (hasZeroAmount)                       reasons.push('Zero Amount');
    if (hasUnknownVendor)                    reasons.push('Unknown Vendor');
    if (isMissingIdentity) reasons.push('Missing VAT & RegNo');
    if (hasFabricatedVat)                    reasons.push('Fabricated VAT (= prefix + regCode)');
    if (isStuck)                             reasons.push(`Stuck in ${d.status}`);
    if (hasSameDates)                        reasons.push('dueDate = dateCreated (suspicious)');
    if (hasMissingDescription)               reasons.push('Missing Description');
    if (hasZeroTaxOnTaxableAmount && hasMissingFile) reasons.push('Zero tax but amount = subtotal');
    if (hasAbsurdTax)                            reasons.push('Absurd tax (tax >= amount)');
    return reasons;
}

async function findBadStatuses() {
    const chunkSize = 10;
    const allDocs = [];
    for (let i = 0; i < PROBLEM_STATUSES.length; i += chunkSize) {
        const chunk = PROBLEM_STATUSES.slice(i, i + chunkSize);
        let q = colInvoices().where('status', 'in', chunk);
        if (companyFilter) q = q.where('companyId', '==', companyFilter);
        const snap = await q.get();
        snap.forEach(doc => allDocs.push(doc));
    }
    const seen = new Set();
    return allDocs
        .filter(doc => { if (seen.has(doc.id)) return false; seen.add(doc.id); return true; })
        .map(doc => ({ id: doc.id, data: doc.data(), reason: `Bad status: ${doc.data().status}` }));
}

// ─── Get Original File ──────────────────────────────────────────────────────

/**
 * Download file from a URL (Firebase Storage signed URL).
 */
function downloadUrl(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
                return downloadUrl(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Retrieve the original file buffer for re-extraction.
 * Priority: 1) Firebase Storage via fileUrl  2) Storage via stagingId  3) null
 */
async function getOriginalFile(invoiceData) {
    // 1. Try fileUrl
    if (invoiceData.fileUrl && invoiceData.fileUrl !== 'BODY_TEXT_NO_ATTACHMENT') {
        try {
            const buffer = await downloadUrl(invoiceData.fileUrl);
            if (buffer && buffer.length > 100) return { buffer, mimeType: 'application/pdf' };
        } catch (err) {
            console.warn(`  [Repairman] fileUrl download failed: ${err.message}`);
        }
    }

    // 2. Try stagingId → raw_documents → storageUrl
    if (invoiceData.stagingId) {
        try {
            const staging = await getStagedDocument(invoiceData.stagingId);
            if (staging && staging.storageUrl) {
                const buffer = await downloadUrl(staging.storageUrl);
                if (buffer && buffer.length > 100) return { buffer, mimeType: 'application/pdf' };
            }
        } catch (err) {
            console.warn(`  [Repairman] Staging download failed: ${err.message}`);
        }
    }

    return null;
}

// ─── Bank Transaction Check ─────────────────────────────────────────────────

const { canReconcile, matchReference, vendorOverlap } = require('./core/reconcile_rules.cjs');

/**
 * Check bank_transactions archive for a matching payment.
 * Uses strict canReconcile rule (reference + vendor overlap + amount + idempotency).
 * Returns 'Paid' if found, null otherwise.
 */
async function checkBankTransactions(invoiceId, oldData, newData) {
    const amount = cleanNum(newData.amount || oldData.amount);
    if (amount <= 0) return null;

    const companyId = oldData.companyId;
    if (!companyId) return null;

    const snap = await colBankTx()
        .where('companyId', '==', companyId)
        .get();

    if (snap.empty) return null;

    const invoice = {
        invoiceId: newData.invoiceId || oldData.invoiceId,
        vendorName: newData.vendorName || oldData.vendorName,
        amount,
    };

    const invoiceDate = newData.dateCreated || oldData.dateCreated || '';

    for (const doc of snap.docs) {
        const tx = doc.data();
        // Date guard: payment cannot be before invoice was created
        if (invoiceDate && tx.date && tx.date < invoiceDate) continue;

        // Skip if this tx is already matched to a different invoice (idempotency)
        if (tx.matchedInvoiceId && tx.matchedInvoiceId !== invoiceId) continue;

        const result = canReconcile(invoice, { ...tx, matchedInvoiceId: null });
        if (result.ok) {
            console.log(`  [Repairman] 🏦 Strict match: €${tx.amount} to "${tx.counterparty}" ref="${tx.reference}" (${result.kind}/${result.payment})`);
            return 'Paid';
        }
    }

    return null;
}

/**
 * Audit all Paid invoices — verify each has a legitimately matched bank transaction.
 * Reverts false Paid statuses to Overdue. Dry-run default; pass --fix to apply.
 */
async function checkAllPaidInvoices({ fix = false } = {}) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Audit Paid invoices ${fix ? '(LIVE)' : '(DRY RUN)'}`);
    console.log(`${'═'.repeat(60)}\n`);

    const paidSnap = await colInvoices().where('status', '==', 'Paid').get();
    let checked = 0, reverted = 0, suspicious = 0, ok = 0;

    for (const invDoc of paidSnap.docs) {
        const d = invDoc.data();
        checked++;

        const txSnap = await colBankTx()
            .where('matchedInvoiceId', '==', invDoc.id)
            .get();

        if (txSnap.empty) {
            console.log(`[audit] ${invDoc.id} (${d.vendorName} / ${d.invoiceId}): Paid without bank link`);
            suspicious++;
            continue;
        }

        const tx = txSnap.docs[0].data();
        const refOk = matchReference(d.invoiceId, tx.reference);
        const vendorOk = vendorOverlap(d.vendorName, tx.counterparty);

        if (refOk && vendorOk) {
            ok++;
            continue;
        }

        console.log(`[audit] REVERT ${invDoc.id}: ${d.vendorName} / ${d.invoiceId} ← tx ${txSnap.docs[0].id} (ref=${tx.reference}, cp=${tx.counterparty}) refOk=${!!refOk} vendorOk=${vendorOk}`);
        reverted++;

        if (fix) {
            try {
                await invDoc.ref.update({ status: 'Overdue' });
                await txSnap.docs[0].ref.update({ matchedInvoiceId: null });
            } catch (err) {
                console.error(`    ERROR reverting: ${err.message}`);
            }
        }
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Checked: ${checked} | OK: ${ok} | Reverted: ${reverted} | Suspicious (no link): ${suspicious}`);
    if (!fix && reverted > 0) console.log(`DRY RUN — run with --audit-paid --fix to apply`);
    console.log(`${'═'.repeat(60)}\n`);
    return { checked, ok, reverted, suspicious };
}

// ─── Core Repair Function ───────────────────────────────────────────────────

/**
 * Repair a single invoice by re-extracting from the original file.
 * UPDATES the record in place — never deletes.
 * If manuallyEdited=true, only fills empty fields.
 *
 * @param {string} invoiceId - Firestore document ID
 * @param {object} invoiceData - Current invoice data from Firestore
 * @returns {Promise<boolean>} true if repaired successfully
 */
async function repairInvoice(invoiceId, invoiceData) {
    console.log(`  [Repairman] Repairing ${invoiceId} (${invoiceData.vendorName || 'unknown'})...`);

    const file = await getOriginalFile(invoiceData);
    if (!file) {
        console.warn(`  [Repairman] No original file found for ${invoiceId}. Marking UNREPAIRABLE.`);
        await colInvoices().doc(invoiceId).update({ status: 'UNREPAIRABLE' });
        return false;
    }

    // Lazy-load to avoid circular dependencies
    const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
    const { validateAndTeach } = require('./teacher_agent.cjs');

    // Re-extract with Scout
    let scoutResult;
    try {
        scoutResult = await processInvoiceWithDocAI(file.buffer, file.mimeType);
    } catch (err) {
        console.error(`  [Repairman] Scout extraction failed: ${err.message}`);
        return false;
    }

    if (!scoutResult || scoutResult.length === 0) {
        console.warn(`  [Repairman] Scout returned empty for ${invoiceId}.`);
        return false;
    }

    // Preserve isPaid flag from Scout extraction (Kaardimakse detection)
    const scoutIsPaid = scoutResult[0].isPaid || false;

    // Re-validate with Teacher
    const teacherResult = await validateAndTeach(scoutResult[0], invoiceData.companyId, scoutResult[0]._rawText || '');

    // Build update object
    const newData = teacherResult.invoice;
    if (scoutIsPaid) newData.isPaid = true;
    const updates = {};
    const isManual = invoiceData.manuallyEdited === true;

    // Clean fabricated VAT before applying updates
    if (invoiceData.supplierVat && invoiceData.supplierRegistration &&
        invoiceData.supplierVat.slice(2) === invoiceData.supplierRegistration) {
        updates.supplierVat = '';
        console.log(`  [Repairman] 🧹 Cleared fabricated VAT: ${invoiceData.supplierVat}`);
    }

    const UPDATABLE_FIELDS = [
        'vendorName', 'invoiceId', 'description', 'amount', 'currency',
        'dateCreated', 'dueDate', 'supplierVat', 'supplierRegistration',
        'subtotalAmount', 'taxAmount',
    ];

    for (const field of UPDATABLE_FIELDS) {
        if (isManual) {
            // Manual edit: only fill empty fields, never overwrite
            if (isEmpty(invoiceData[field]) && !isEmpty(newData[field])) {
                updates[field] = newData[field];
            }
        } else {
            // Auto record: overwrite with fresh extraction
            if (!isEmpty(newData[field])) {
                updates[field] = newData[field];
            }
        }
    }

    // Normalize vendor name
    const rawVendor = updates.vendorName || invoiceData.vendorName;
    const cleanVendor = normalizeVendorName(rawVendor);
    if (cleanVendor !== rawVendor) {
        updates.vendorName = cleanVendor;
    }

    // Always update metadata
    updates.repairedAt = admin.firestore.FieldValue.serverTimestamp();
    updates.repairHistory = admin.firestore.FieldValue.arrayUnion({
        timestamp: new Date().toISOString(),
        corrections: teacherResult.corrections,
    });

    // Set status using unified status rules
    if (!isManual) {
        // Kaardimakse (card payment) or isPaid from extraction → always Paid
        if (newData.isPaid || invoiceData.isPaid) {
            updates.status = 'Paid';
            console.log(`  [Repairman] Status → Paid (isPaid from extraction — Kaardimakse/card payment)`);
        } else if (!teacherResult.approved) {
            updates.status = 'Needs Action';
        } else {
            // Check bank_transactions for payment
            let isPaid = false;
            try {
                const paymentStatus = await checkBankTransactions(invoiceId, invoiceData, newData);
                if (paymentStatus === 'Paid') {
                    isPaid = true;
                    console.log(`  [Repairman] 🏦 Payment found in bank_transactions archive`);
                }
            } catch (btErr) {
                console.warn(`  [Repairman] bank_transactions check failed: ${btErr.message}`);
            }
            const dueDate = newData.dueDate || invoiceData.dueDate;
            updates.status = determineStatus('Pending', dueDate, isPaid);
            console.log(`  [Repairman] Status → ${updates.status} (dueDate: ${dueDate || 'none'})`);
        }
    }

    // Teacher corrections metadata
    if (teacherResult.corrections.length > 0) {
        updates.teacherCorrections = teacherResult.corrections;
    }

    // ── Post-repair quality check (Teacher verifies Repairman's work) ──
    const finalAmount = updates.amount ?? newData.amount ?? invoiceData.amount ?? 0;
    const finalSub = updates.subtotalAmount ?? newData.subtotalAmount ?? invoiceData.subtotalAmount ?? 0;
    const finalTax = updates.taxAmount ?? newData.taxAmount ?? invoiceData.taxAmount ?? 0;
    const qualityIssues = [];
    // Math check removed — sub + tax ≠ total is normal for leasing/mixed-VAT invoices
    if (!updates.vendorName && isEmpty(newData.vendorName) && isEmpty(invoiceData.vendorName)) {
        qualityIssues.push('Missing vendor name');
    }
    // ── Teacher QC loop: Teacher checks, tells Repairman what to fix, max 2 retries ──
    // ── Teacher QC: detect issues → try fix → verify ──────────────────────
    const OUR_COMPANIES = ['global technics', 'ideacom'];

    function detectQcIssues() {
        const qcAmount = cleanNum(updates.amount ?? newData.amount ?? invoiceData.amount);
        const qcSub = cleanNum(updates.subtotalAmount ?? newData.subtotalAmount ?? invoiceData.subtotalAmount);
        const qcTax = cleanNum(updates.taxAmount ?? newData.taxAmount ?? invoiceData.taxAmount);
        const qcVendor = (updates.vendorName || newData.vendorName || invoiceData.vendorName || '').toLowerCase();
        const issues = [];
        if (qcAmount > 0 && qcSub > 0 && Math.abs(qcSub + qcTax - qcAmount) > 0.50)
            issues.push({ type: 'math', msg: `sub(${qcSub}) + tax(${qcTax}) = ${(qcSub + qcTax).toFixed(2)} ≠ amount(${qcAmount})` });
        if (OUR_COMPANIES.some(c => qcVendor.includes(c)))
            issues.push({ type: 'vendor', msg: `vendorName "${qcVendor}" is our company` });
        if (!updates.vendorName && isEmpty(newData.vendorName) && isEmpty(invoiceData.vendorName))
            issues.push({ type: 'vendor', msg: 'Missing vendor name' });
        return { issues, qcAmount, qcSub, qcTax };
    }

    let { issues: qcIssues, qcAmount, qcSub, qcTax } = detectQcIssues();

    if (qcIssues.length > 0) {
        const hasMathOnly = qcIssues.every(i => i.type === 'math');
        const issueMessages = qcIssues.map(i => i.msg);
        console.log(`  [Teacher QC] Issues: ${issueMessages.join(' | ')}`);

        // Step 1: Try arithmetic fix (only for math issues, skip for vendor issues)
        if (hasMathOnly) {
            if (qcAmount > 0 && qcTax > 0 && qcTax < qcAmount) {
                updates.subtotalAmount = cleanNum((qcAmount - qcTax).toFixed(2));
                console.log(`  [Repairman] Fixed sub: ${qcSub} → ${updates.subtotalAmount}`);
            } else if (qcAmount > 0 && qcSub > 0 && qcSub < qcAmount) {
                updates.taxAmount = cleanNum((qcAmount - qcSub).toFixed(2));
                console.log(`  [Repairman] Fixed tax: ${qcTax} → ${updates.taxAmount}`);
            }
            // Re-check
            ({ issues: qcIssues } = detectQcIssues());
        }

        // Step 2: If still issues → Claude (once per invoice)
        if (qcIssues.length > 0 && !invoiceData.claudeFixAttempted) {
            try {
                const { askClaudeToFix } = require('./document_ai_service.cjs');
                const rawText = scoutResult[0]?._rawText || '';
                const fixes = await askClaudeToFix(rawText, {
                    vendorName: updates.vendorName || newData.vendorName || invoiceData.vendorName,
                    invoiceId: updates.invoiceId || newData.invoiceId || invoiceData.invoiceId,
                    amount: qcAmount, subtotalAmount: qcSub, taxAmount: qcTax,
                    currency: updates.currency || newData.currency || invoiceData.currency,
                    dateCreated: updates.dateCreated || newData.dateCreated || invoiceData.dateCreated,
                    dueDate: updates.dueDate || newData.dueDate || invoiceData.dueDate,
                }, qcIssues.map(i => i.msg));

                if (fixes && Object.keys(fixes).length > 0) {
                    if (fixes.vendorName) updates.vendorName = fixes.vendorName;
                    // CURRENCY RULE: if Claude changes currency, amount must change together.
                    // Claude's own amount in new currency is authoritative.
                    const currentCurrency = updates.currency || newData.currency || invoiceData.currency;
                    if (fixes.currency !== undefined && fixes.currency !== currentCurrency) {
                        updates.currency = fixes.currency;
                        if (fixes.amount !== undefined) updates.amount = fixes.amount;
                        if (fixes.subtotalAmount !== undefined) updates.subtotalAmount = fixes.subtotalAmount;
                        if (fixes.taxAmount !== undefined) updates.taxAmount = fixes.taxAmount;
                        console.log(`  [Claude QC] Currency changed to ${fixes.currency}, amount=${fixes.amount}`);
                    } else {
                        if (fixes.amount !== undefined) updates.amount = fixes.amount;
                        if (fixes.subtotalAmount !== undefined) updates.subtotalAmount = fixes.subtotalAmount;
                        if (fixes.taxAmount !== undefined) updates.taxAmount = fixes.taxAmount;
                    }
                    if (fixes.invoiceId) updates.invoiceId = fixes.invoiceId;
                    if (fixes.supplierVat) updates.supplierVat = fixes.supplierVat;
                    if (fixes.supplierRegistration) updates.supplierRegistration = fixes.supplierRegistration;
                    if (fixes.isPaid) updates.status = 'Paid';
                }
                updates.claudeFixAttempted = true;
            } catch (claudeErr) {
                console.warn(`  [Claude QC] ⚠️ Error: ${claudeErr.message}`);
                updates.claudeFixAttempted = true;
            }

            // Step 3: Final check after Claude
            ({ issues: qcIssues } = detectQcIssues());
        }

        // Still broken → reject
        if (qcIssues.length > 0) {
            console.warn(`  [Teacher QC] ❌ REJECTED: ${qcIssues.map(i => i.msg).join(' | ')}`);
            await colInvoices().doc(invoiceId).update({
                status: 'Needs Action',
                repairQualityWarnings: qcIssues.map(i => i.msg),
                claudeFixAttempted: true,
                repairedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            return false;
        }
    }

    // ── PARTIAL PAYMENT PROTECTION ─────────────────────────────────────────
    // If invoice has payments[] recorded, NEVER overwrite amount with original
    // from PDF. The displayed amount = remainingAmount (what's still owed).
    const existingPayments = invoiceData.payments || [];
    if (existingPayments.length > 0) {
        // Preserve payment state — don't let DocAI re-extraction overwrite
        delete updates.amount;
        delete updates.originalAmount;
        delete updates.remainingAmount;
        delete updates.payments;
        console.log(`  [Repairman] 🛡️ Partial payment protection: ${existingPayments.length} payment(s) — amount/remaining preserved`);
    }

    await colInvoices().doc(invoiceId).update(updates);
    console.log(`  [Repairman] ✅ Updated ${invoiceId} with ${Object.keys(updates).length - 2} field(s).`);

    // Update staging
    if (invoiceData.stagingId) {
        await markRepairPending(invoiceData.stagingId);
        await incrementRepairAttempts(invoiceData.stagingId);
    }

    // Log repair
    await logRepair({
        repairedDocId: invoiceId,
        invoiceId:     invoiceData.invoiceId,
        vendorName:    invoiceData.vendorName,
        reason:        'Re-extracted from original file',
        stagingId:     invoiceData.stagingId,
        mode,
    });

    return true;
}

// ─── Infinite Loop Protection ────────────────────────────────────────────────

async function classifyByRepairAttempts(invoices) {
    const repairable = [];
    const unrepairable = [];
    for (const inv of invoices) {
        const attempts = await getRepairAttempts(inv.data.stagingId);
        if (attempts >= MAX_REPAIR_ATTEMPTS) {
            unrepairable.push({ ...inv, repairAttempts: attempts });
        } else {
            repairable.push(inv);
        }
    }
    return { repairable, unrepairable };
}

// ─── Report Printer ──────────────────────────────────────────────────────────

function printReport(invoices, label) {
    if (invoices.length === 0) return;
    console.log(`\n${label} (${invoices.length}):\n`);
    console.log(`${'Firestore ID'.padEnd(22)} ${'Vendor'.padEnd(30)} ${'Created'.padEnd(12)} Reason`);
    console.log('─'.repeat(90));
    for (const { id, data, reason } of invoices) {
        const ts = data.createdAt?.toDate ? data.createdAt.toDate() : null;
        const vendor = (data.vendorName || 'UNKNOWN').slice(0, 28).padEnd(30);
        const created = ts ? ts.toISOString().slice(0, 10).padEnd(12) : '—'.padEnd(12);
        console.log(`${id.slice(0, 21).padEnd(22)} ${vendor} ${created} ${reason}`);
    }
}

// ─── Vendor Name Normalization ───────────────────────────────────────────────

const VENDOR_CANONICAL = {
    'pronto sp. z o. o.':         'PRONTO Sp. z o.o.',
    'pronto sp. z o.o.':          'PRONTO Sp. z o.o.',
    'täisteenusliisingu as':      'Täisteenusliisingu AS',
    'global technics oü':         'Global Technics OÜ',
    'sia citadele leasing eesti filiaal': 'SIA Citadele Leasing Eesti filiaal',
    'konica minolta':             'Konica Minolta',
    'tele2 eesti as':             'Tele2 Eesti AS',
    'estma terminaali oü':        'ESTMA Terminaali OÜ',
    'memi varustaja oü':          'Memi Varustaja OÜ',
    'as alexela':                 'Alexela AS',
    'allstore assets oü':         'Allstore Assets OÜ',
    'hydroscand as':              'Hydroscand AS',
    'zone media oü':              'Zone Media OÜ',
    'omega laen as':              'Omega Laen AS',
    'lhv':                        'LHV',
    'accounting resources oü':    'Accounting Resources OÜ',
};

function normalizeVendorName(name) {
    if (!name) return name;
    // Fix broken multiline names (e.g. "BMEMI\nVARUSTAJA")
    let clean = name.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const key = clean.toLowerCase();
    return VENDOR_CANONICAL[key] || clean;
}

// ─── Status Determination Rules ─────────────────────────────────────────────
//
//  STATUS RULES (priority order):
//
//  1. Paid    — payment found in bank_transactions (amount + vendor match)
//  2. Overdue — dueDate exists AND dueDate < today AND not Paid
//  3. Pending — dueDate does not exist, OR dueDate >= today, AND not Paid
//
//  Immutable statuses (never overwrite): Paid, Duplicate, UNREPAIRABLE, Needs Action
//

const IMMUTABLE_STATUSES = ['Paid', 'Duplicate', 'UNREPAIRABLE', 'Needs Action'];

function determineStatus(currentStatus, dueDate, isPaidInBank) {
    // Rule 1: bank payment found → always Paid
    if (isPaidInBank) return 'Paid';

    // Rule 2: immutable statuses → don't touch
    if (IMMUTABLE_STATUSES.includes(currentStatus)) return currentStatus;

    // Rule 3: check if overdue
    if (dueDate) {
        const today = new Date().toISOString().slice(0, 10);
        if (dueDate < today) return 'Overdue';
    }

    // Rule 4: default → Pending
    return 'Pending';
}

// ─── Audit Mode: sweep all invoices ─────────────────────────────────────────

async function runAudit() {
    console.log('\n══════════════════════════════════════════════════');
    console.log('AUDIT MODE: Status correction + Vendor normalization');
    console.log('══════════════════════════════════════════════════\n');

    // Load all invoices
    let q = colInvoices();
    if (companyFilter) q = q.where('companyId', '==', companyFilter);
    const snap = await q.get();
    console.log(`Loaded ${snap.size} invoices.\n`);

    const today = new Date().toISOString().slice(0, 10);

    // Load bank transactions for payment verification (second line after Scout)
    const bankTxByCompany = {};
    const bankSnap = await colBankTx().get();
    for (const doc of bankSnap.docs) {
        const tx = doc.data();
        if (!bankTxByCompany[tx.companyId]) bankTxByCompany[tx.companyId] = [];
        bankTxByCompany[tx.companyId].push(tx);
    }
    console.log(`Loaded ${bankSnap.size} bank transactions.\n`);

    let statusFixed = 0, vendorFixed = 0, paidFound = 0, overdueFound = 0, skipped = 0;
    const changes = [];

    for (const doc of snap.docs) {
        const data = doc.data();
        const updates = {};

        // ── Vendor name normalization ──
        const oldVendor = data.vendorName || '';
        const newVendor = normalizeVendorName(oldVendor);
        if (newVendor !== oldVendor) {
            updates.vendorName = newVendor;
            updates.previousVendorName = oldVendor;
        }

        // ── Võlgnevus / Ettemaks correction ──
        // amount = what needs to be PAID (Tasuda kokku), not Arve kokku.
        // If amount > sub+tax → includes debt carry-over → no correction needed
        //   (the debt IS part of what needs to be paid)
        // If amount was extracted wrong (absurd values), full repair re-extracts from file.

        // ── Status determination ──
        // 1. Scout (reconcilePayment) is the first line — matches payments on bank statement arrival
        // 2. Repairman audit is the second line — catches what Scout missed
        // 3. Manual edit (pencil) is the last resort
        const oldStatus = data.status;

        if (oldStatus !== 'Paid' && oldStatus !== 'Duplicate') {
            const invoiceAmount = cleanNum(data.amount);

            // Credit notes (negative amounts) are always Paid
            if (invoiceAmount < 0) {
                updates.status = 'Paid';
                updates.previousStatus = oldStatus;
                updates.statusFixedAt = admin.firestore.FieldValue.serverTimestamp();
                paidFound++;
            }
            // Check bank transactions for payment (second line after Scout)
            else if (invoiceAmount > 0) {
            let isPaidInBank = false;
            const companyTxs = bankTxByCompany[data.companyId] || [];
            if (companyTxs.length > 0) {
                const LEGAL_SUFFIXES = new Set(['as', 'ou', 'oü', 'uab', 'sia', 'llc', 'gmbh', 'inc', 'bv', 'oy', 'aktsiaselts', 'osaühing']);
                const vendorWords = (newVendor || '').toLowerCase().split(/[^a-zöäüõ0-9]+/).filter(w => w.length >= 3 && !LEGAL_SUFFIXES.has(w));
                const invoiceNum = (data.invoiceId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const invoiceDate = data.dateCreated || '';

                for (const tx of companyTxs) {
                    if (invoiceDate && tx.date && tx.date < invoiceDate) continue;

                    const txAmount = cleanNum(tx.amount);
                    if (Math.abs(txAmount - invoiceAmount) > 0.50) continue;

                    const txVendorFull = (tx.counterparty || '').toLowerCase();
                    const txRef = (tx.reference || '').toLowerCase().replace(/[^a-z0-9]/g, '');

                    // Match criteria: vendor name (word-based) + invoice number in reference
                    const refMatch = invoiceNum.length > 3 &&
                        (txRef.includes(invoiceNum) || invoiceNum.includes(txRef));
                    const vendorMatch = vendorWords.length > 0 &&
                        vendorWords.some(w => txVendorFull.includes(w));

                    // Ettemaksuteatis: bank ref contains "ettemaks" — match by vendor+amount only
                    const isEttemaks = (tx.reference || '').toLowerCase().includes('ettemaks');

                    if (vendorMatch && !refMatch && txRef.length > 3 && !isEttemaks) continue;
                    if (vendorMatch || refMatch) { isPaidInBank = true; break; }
                }
            }

            if (isPaidInBank) {
                updates.status = 'Paid';
                updates.previousStatus = oldStatus;
                updates.statusFixedAt = admin.firestore.FieldValue.serverTimestamp();
                paidFound++;
            } else if (oldStatus !== 'Overdue' && data.dueDate && data.dueDate < today) {
                updates.status = 'Overdue';
                updates.previousStatus = oldStatus;
                updates.statusFixedAt = admin.firestore.FieldValue.serverTimestamp();
                overdueFound++;
            }
            } // close else if (invoiceAmount > 0)
        }

        // ── Paid invoice: sync amount with bank transaction ──
        // Foreign currency invoices (USD, PLN) get paid in EUR.
        // The displayed amount should reflect what was actually paid (EUR from bank statement).
        const companyTxs = bankTxByCompany[data.companyId] || [];
        if ((data.status === 'Paid' || updates.status === 'Paid') && companyTxs.length > 0) {
            const matchedTx = companyTxs.find(tx => tx.matchedInvoiceId === doc.id);
            if (matchedTx) {
                const txAmount = cleanNum(matchedTx.amount);
                const invAmount = cleanNum(data.amount);
                if (txAmount > 0 && Math.abs(txAmount - invAmount) > 0.01) {
                    updates.amount = txAmount;
                    updates.currency = 'EUR';  // bank statement is always EUR
                    if (!data.originalAmount) updates.originalAmount = invAmount;
                }
            }
        }

        // ── Apply updates ──
        if (Object.keys(updates).length === 0) {
            skipped++;
            continue;
        }

        const changeDesc = [];
        if (updates.status) changeDesc.push(`${oldStatus} → ${updates.status}`);
        if (updates.vendorName) changeDesc.push(`vendor: "${oldVendor}" → "${updates.vendorName}"`);

        changes.push({ id: doc.id, vendor: newVendor || oldVendor, change: changeDesc.join(' | ') });

        if (!dryRun) {
            await colInvoices().doc(doc.id).update(updates);
        }

        if (updates.status) statusFixed++;
        if (updates.vendorName) vendorFixed++;
    }

    // ── Report ──
    console.log('─── CHANGES ───\n');
    if (changes.length === 0) {
        console.log('No changes needed.');
    } else {
        console.log(`${'ID'.padEnd(22)} ${'Vendor'.padEnd(35)} Change`);
        console.log('─'.repeat(100));
        for (const c of changes) {
            console.log(`${c.id.slice(0, 21).padEnd(22)} ${c.vendor.slice(0, 33).padEnd(35)} ${c.change}`);
        }
    }

    console.log('\n══════════════════════════════════════════════════');
    console.log(`${dryRun ? '[DRY RUN] Would apply' : 'Applied'}:`);
    console.log(`  Status fixes:  ${statusFixed} (${paidFound} → Paid, ${overdueFound} → Overdue)`);
    console.log(`  Vendor fixes:  ${vendorFixed}`);
    console.log(`  Skipped:       ${skipped} (no changes needed)`);
    if (dryRun && changes.length > 0) console.log('\nRun with --fix to execute.');
    console.log('══════════════════════════════════════════════════');
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

async function main() {
    console.log('─────────────────────────────────────────────────');
    console.log('РЕМОНТНИК (Repairman Agent) v3');
    console.log(`Mode: ${mode.toUpperCase()}`);
    console.log(`Date Range: ${sinceArg || 'all'} to ${untilArg || 'now'}`);
    if (companyFilter) console.log(`Company: ${companyFilter}`);
    console.log(dryRun ? 'DRY RUN (pass --fix to execute)' : 'LIVE EXECUTION');
    console.log('─────────────────────────────────────────────────\n');

    // ── Audit mode: separate flow ──────────────────────────────────────────
    if (mode === 'audit') { await runAudit(); process.exit(0); }

    // ── Step 1: Find problems ────────────────────────────────────────────────
    console.log('Step 1: Scanning Firestore...');
    const allBad = await findBadInvoices();

    if (allBad.length === 0) {
        console.log('All invoices look healthy. No repairs needed.');
        process.exit(0);
    }

    console.log(`Found ${allBad.length} problematic record(s).`);

    // ── Step 2: Classify repairable vs unrepairable ──────────────────────────
    let repairable, unrepairable;

    if (mode === 'statuses') {
        repairable = allBad;
        unrepairable = [];
    } else {
        console.log('\nStep 2: Checking repair history...');
        ({ repairable, unrepairable } = await classifyByRepairAttempts(allBad));
    }

    printReport(repairable, 'REPAIRABLE');

    if (unrepairable.length > 0) {
        printReport(unrepairable, 'UNREPAIRABLE (max attempts reached — needs manual review)');
        if (!dryRun) {
            for (const inv of unrepairable) {
                try { await colInvoices().doc(inv.id).update({ status: 'UNREPAIRABLE' }); } catch { /* ignore */ }
            }
            console.log(`  Marked ${unrepairable.length} record(s) as UNREPAIRABLE.`);
        }
    }

    if (repairable.length === 0) {
        console.log('\nNo repairable records.');
        process.exit(0);
    }

    // ── Step 3: Execute repairs ──────────────────────────────────────────────

    if (mode === 'statuses') {
        console.log(`\nStep 3: ${dryRun ? '[DRY RUN] Would reset' : 'Resetting'} ${repairable.length} record(s) to Pending...`);
        if (!dryRun) {
            const BATCH_SIZE = 400;
            let fixed = 0;
            for (let i = 0; i < repairable.length; i += BATCH_SIZE) {
                const batch = db.batch();
                const chunk = repairable.slice(i, i + BATCH_SIZE);
                for (const { id, data } of chunk) {
                    batch.update(colInvoices().doc(id), {
                        status: 'Pending',
                        previousStatus: data.status,
                        statusFixedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
                await batch.commit();
                fixed += chunk.length;
            }
            for (const inv of repairable) {
                await logRepair({ repairedDocId: inv.id, invoiceId: inv.data.invoiceId, vendorName: inv.data.vendorName, reason: inv.reason, stagingId: inv.data.stagingId, mode: 'statuses' });
            }
            console.log(`Done. ${fixed} record(s) reset to Pending.`);
        }
        process.exit(0);
    }

    // ── Step 2b: Handle duplicates — mark as Duplicate, don't re-extract ────
    const duplicates = repairable.filter(inv => inv.reason.startsWith('Duplicate of'));
    const toRepair = repairable.filter(inv => !inv.reason.startsWith('Duplicate of'));

    if (duplicates.length > 0) {
        console.log(`\nStep 2b: ${dryRun ? '[DRY RUN] Would delete' : 'Deleting'} ${duplicates.length} duplicate(s)...`);
        if (!dryRun) {
            for (const inv of duplicates) {
                try {
                    await colInvoices().doc(inv.id).delete();
                    console.log(`  [Repairman] 🗑️  Deleted duplicate ${inv.id} (${inv.reason})`);
                } catch (err) {
                    console.error(`  [Repairman] Error deleting duplicate ${inv.id}: ${err.message}`);
                }
            }
        }
    }

    // Full / Skeletons mode: re-extract and UPDATE
    console.log(`\nStep 3: ${dryRun ? '[DRY RUN] Would repair' : 'Repairing'} ${toRepair.length} record(s)...`);

    if (!dryRun) {
        let repaired = 0;
        let failed = 0;
        for (const inv of toRepair) {
            try {
                const ok = await repairInvoice(inv.id, inv.data);
                if (ok) repaired++; else failed++;
            } catch (err) {
                console.error(`  [Repairman] Error repairing ${inv.id}: ${err.message}`);
                failed++;
            }
        }
        console.log(`\n  Repaired: ${repaired}, Failed: ${failed}`);
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    console.log('\n─────────────────────────────────────────────────');
    if (dryRun) {
        console.log(`Would repair ${repairable.length} record(s). Run with --fix to execute.`);
    } else {
        console.log('Repair complete. Records updated in place.');
        // Auto-run audit after full repair to fix statuses (Overdue, Paid from bank)
        console.log('\n─────────────────────────────────────────────────');
        console.log('Running post-repair audit...');
        await runAudit();
    }

    process.exit(0);
}

// Run as CLI or as library
if (require.main === module) {
    // Special mode: --audit-paid
    if (hasFlag('--audit-paid')) {
        checkAllPaidInvoices({ fix: hasFlag('--fix') })
            .then(() => process.exit(0))
            .catch(err => { console.error('Fatal:', err.message); process.exit(1); });
    } else {
        main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
    }
}

module.exports = { repairInvoice, findBadInvoices, checkAllPaidInvoices };
