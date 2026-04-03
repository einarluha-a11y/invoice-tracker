#!/usr/bin/env node
/**
 * reprocess.cjs — Re-process a staged document without going back to IMAP
 *
 * Reads a raw_documents staging record, re-downloads the PDF from Firebase
 * Storage via Admin SDK, and re-runs the full processing pipeline.
 *
 * Usage:
 *   node reprocess.cjs --docId <staging_doc_id>           # re-process one doc
 *   node reprocess.cjs --status error --limit 10          # re-process last 10 errors
 *   node reprocess.cjs --status pending --company <id>    # re-process pending for company
 *   node reprocess.cjs --list                             # list recent staged docs
 *   node reprocess.cjs --dry-run --docId <id>             # show what would happen, don't write
 */

const { getStagedDocument, listStagedDocuments, stageDocument, markStagingResult } = require('./core/staging.cjs');
const { admin, db } = require('./core/firebase.cjs');

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(name);

const docId   = getArg('--docId');
const status  = getArg('--status');
const company = getArg('--company');
const limit   = parseInt(getArg('--limit') || '20', 10);
const dryRun  = hasFlag('--dry-run');
const listMode = hasFlag('--list');

// ─── Lazy-load heavy pipeline modules (same as imap_daemon) ───────────────────
let _pipeline = null;
async function getPipeline() {
    if (_pipeline) return _pipeline;
    const pdfParse          = require('pdf-parse');
    const { parseBankStatementWithAI, reconcilePayment } = require('./accountant_agent.cjs');
    const { runMakerCheckerLoop }    = require('./maker_checker.cjs');
    const { classifyDocumentWithVision } = require('./vision_auditor.cjs');
    const { auditAndProcessInvoice } = require('./accountant_agent.cjs');
    const { writeToFirestore }       = require('./firestore_writer.cjs');
    const { safetyNetSave }          = require('./safety_net.cjs');
    _pipeline = { pdfParse, parseBankStatementWithAI, reconcilePayment,
                  runMakerCheckerLoop, classifyDocumentWithVision, auditAndProcessInvoice,
                  writeToFirestore, safetyNetSave };
    return _pipeline;
}

/**
 * Download file from Firebase Storage via Admin SDK (bypasses token expiry).
 */
async function downloadFromStorage(storageUrl) {
    const bucket = admin.storage().bucket();
    let filePath;
    if (storageUrl.startsWith('gs://')) {
        filePath = storageUrl.replace(/^gs:\/\/[^/]+\//, '');
    } else {
        // https://firebasestorage.googleapis.com/v0/b/.../o/PATH?token=...
        const urlObj = new URL(storageUrl);
        filePath = decodeURIComponent(urlObj.pathname.split('/o/')[1]);
    }
    console.log(`[Reprocess] 📥 Downloading from Storage: ${filePath}`);
    const [buffer] = await bucket.file(filePath).download();
    return buffer;
}

/**
 * Determine MIME type from filename.
 */
function mimeFromFilename(filename) {
    if (!filename) return 'application/octet-stream';
    const ext = filename.split('.').pop().toLowerCase();
    const map = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg',
                  png: 'image/png', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    return map[ext] || 'application/octet-stream';
}

/**
 * Re-process a single staged document.
 */
async function reprocessDocument(stagedDoc, { dry = false } = {}) {
    const { id, type, companyId, source, storageUrl, rawText } = stagedDoc;
    console.log(`\n[Reprocess] ─────────────────────────────────────────`);
    console.log(`[Reprocess] 📄 Document: ${id}`);
    console.log(`[Reprocess]    Type: ${type} | Company: ${companyId}`);
    console.log(`[Reprocess]    File: ${source?.filename || '(unknown)'}`);
    console.log(`[Reprocess]    From: ${source?.from || '(unknown)'}`);

    if (!storageUrl) {
        console.error(`[Reprocess] ❌ No storageUrl — cannot re-process without the file.`);
        return false;
    }

    if (dry) {
        console.log(`[Reprocess] 🔍 DRY RUN — would re-process this document, no writes.`);
        return true;
    }

    // ── Load pipeline ─────────────────────────────────────────────────────────
    const { pdfParse, parseBankStatementWithAI, reconcilePayment,
            runMakerCheckerLoop, classifyDocumentWithVision, auditAndProcessInvoice,
            writeToFirestore, safetyNetSave } = await getPipeline();

    // ── Download file ─────────────────────────────────────────────────────────
    let fileBuffer;
    try {
        fileBuffer = await downloadFromStorage(storageUrl);
    } catch (err) {
        console.error(`[Reprocess] ❌ Storage download failed: ${err.message}`);
        await markStagingResult(id, { status: 'error', error: `Reprocess storage download: ${err.message}` });
        return false;
    }

    const filename = source?.filename || 'unknown';
    const mime     = mimeFromFilename(filename);

    // ── Load global AI rules ────────────────────────────────────────────────────
    const { getGlobalAiRules } = require('./core/firebase.cjs');
    let customRules = '';
    try {
        customRules = await getGlobalAiRules();
    } catch (_) {}

    // ── Helper: save parsed invoices to Firestore ─────────────────────────────
    const saveParsedData = async (data) => {
        if (!data || !Array.isArray(data) || data.length === 0) return false;
        let success = false;
        for (let inv of data) {
            inv.companyId = companyId;
            const auditedData = await auditAndProcessInvoice(inv, storageUrl, companyId);
            if (auditedData.status === 'Duplicate') {
                console.log(`[Reprocess]    ℹ️  Duplicate — skipping.`);
                success = true;
            } else if (auditedData.status === 'Error') {
                console.error(`[Reprocess]    🛑 Accountant Agent returned Error.`);
                await safetyNetSave(auditedData, (auditedData.validationWarnings || []).join('; ') || 'Error', companyId, storageUrl).catch(() => {});
                success = true;
            } else {
                auditedData.stagingId = id; // Back-link to raw_documents for source tracing
                await writeToFirestore([auditedData]);
                console.log(`[Reprocess]    ✅ Saved to Firestore.`);
                success = true;
            }
        }
        return success;
    };

    try {
        // ── PDF path ──────────────────────────────────────────────────────────
        if (mime === 'application/pdf') {
            // Use cached rawText if available (avoids re-parsing)
            const content = rawText || (await pdfParse(fileBuffer)).text;
            const lowerText = content.toLowerCase();
            const isBankStatement = lowerText.includes('выписка по счету') || lowerText.includes('konto väljavõte') || lowerText.includes('account statement');

            if (isBankStatement) {
                console.log(`[Reprocess] 🏦 Re-processing as Bank Statement...`);
                const txs = await parseBankStatementWithAI(content);
                if (txs && Array.isArray(txs)) {
                    for (const tx of txs) {
                        await reconcilePayment(tx.reference || '', tx.description || '', tx.amount, null, null, tx.date || new Date().toISOString().split('T')[0], null, null, companyId);
                    }
                    await markStagingResult(id, { status: 'success', resultIds: [] });
                    console.log(`[Reprocess] ✅ Bank statement re-processed. ${txs.length} transactions.`);
                }
            } else {
                console.log(`[Reprocess] 📃 Re-processing as Invoice PDF...`);
                const visionClass = await classifyDocumentWithVision(fileBuffer, mime);
                if (visionClass !== null && visionClass !== 'INVOICE') {
                    console.warn(`[Reprocess] ⚠️  Vision classified as ${visionClass}. Skipping.`);
                    await markStagingResult(id, { status: 'skipped', error: `Vision: ${visionClass}` });
                    return false;
                }
                const parsed = await runMakerCheckerLoop(fileBuffer, mime, { customAiRules: customRules });
                if (await saveParsedData(parsed)) {
                    await markStagingResult(id, { status: 'success', resultIds: [] });
                    console.log(`[Reprocess] ✅ Invoice PDF re-processed.`);
                    return true;
                }
            }

        // ── Image path ────────────────────────────────────────────────────────
        } else if (mime.startsWith('image/')) {
            console.log(`[Reprocess] 🖼  Re-processing as Image Invoice...`);
            const visionClass = await classifyDocumentWithVision(fileBuffer, mime);
            if (visionClass !== null && visionClass !== 'INVOICE') {
                console.warn(`[Reprocess] ⚠️  Vision classified as ${visionClass}. Skipping.`);
                await markStagingResult(id, { status: 'skipped', error: `Vision: ${visionClass}` });
                return false;
            }
            const parsed = await runMakerCheckerLoop(fileBuffer, mime, { customAiRules: customRules });
            if (await saveParsedData(parsed)) {
                await markStagingResult(id, { status: 'success', resultIds: [] });
                console.log(`[Reprocess] ✅ Image invoice re-processed.`);
                return true;
            }

        // ── CSV / text path ───────────────────────────────────────────────────
        } else {
            const content = rawText || fileBuffer.toString('utf-8');
            if (content.includes('Date started (UTC)') && content.includes('State') && content.includes('Reference')) {
                console.log(`[Reprocess] 🏦 Re-processing as CSV Bank Statement...`);
                const { processBankStatement } = require('./accountant_agent.cjs');
                await processBankStatement(content, companyId);
                await markStagingResult(id, { status: 'success', resultIds: [] });
                console.log(`[Reprocess] ✅ CSV bank statement re-processed.`);
            } else {
                console.warn(`[Reprocess] ⚠️  Body-text email skipped — Google Document AI requires a PDF or image file.`);
                await markStagingResult(id, { status: 'skipped', error: 'Body-text without attachment not supported by DocAI' });
                return false;
            }
        }
    } catch (err) {
        console.error(`[Reprocess] ❌ Pipeline error: ${err.message}`);
        await markStagingResult(id, { status: 'error', error: `Reprocess pipeline: ${err.message}` });
        return false;
    }

    return true;
}

// ─── List mode ────────────────────────────────────────────────────────────────
async function runList() {
    const filter = {};
    if (company) filter.companyId = company;
    if (status)  filter.status   = status;
    filter.limit = limit;
    const docs = await listStagedDocuments(filter);
    if (docs.length === 0) {
        console.log('[Reprocess] No staged documents found.');
        return;
    }
    console.log(`\n${'ID'.padEnd(25)} ${'Status'.padEnd(12)} ${'Type'.padEnd(16)} ${'Filename'.padEnd(35)} Received`);
    console.log('─'.repeat(110));
    for (const d of docs) {
        const received = d.receivedAt?._seconds
            ? new Date(d.receivedAt._seconds * 1000).toISOString().slice(0, 16)
            : '—';
        console.log(`${d.id.padEnd(25)} ${(d.processingStatus||'').padEnd(12)} ${(d.type||'').padEnd(16)} ${(d.source?.filename||'').slice(0,34).padEnd(35)} ${received}`);
    }
    console.log(`\nTotal: ${docs.length}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
    if (listMode) {
        await runList();
        process.exit(0);
    }

    if (!docId && !status) {
        console.error('Usage:');
        console.error('  node reprocess.cjs --docId <id>');
        console.error('  node reprocess.cjs --status error [--company <id>] [--limit 20]');
        console.error('  node reprocess.cjs --status pending [--company <id>] [--limit 20]');
        console.error('  node reprocess.cjs --list [--status <s>] [--company <id>] [--limit 20]');
        console.error('  node reprocess.cjs --dry-run --docId <id>');
        process.exit(1);
    }

    if (docId) {
        // Single document
        const doc = await getStagedDocument(docId);
        await reprocessDocument(doc, { dry: dryRun });
    } else {
        // Batch by status
        const filter = { status, limit };
        if (company) filter.companyId = company;
        const docs = await listStagedDocuments(filter);
        console.log(`[Reprocess] Found ${docs.length} documents with status='${status}'.`);
        for (const doc of docs) {
            await reprocessDocument(doc, { dry: dryRun });
        }
    }

    console.log('\n[Reprocess] Done.');
    process.exit(0);
})();
