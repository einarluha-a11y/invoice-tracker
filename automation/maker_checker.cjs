/**
 * maker_checker.cjs — AI extraction pipeline wrapper
 *
 * Implements runMakerCheckerLoop: classifies a document with Vision API,
 * then extracts invoice data using Google Document AI.
 *
 * Used by reprocess.cjs to re-process staged documents without IMAP.
 *
 * @param {Buffer} fileBuffer  — raw file bytes (PDF or image)
 * @param {string} mime        — MIME type (e.g. 'application/pdf', 'image/png')
 * @param {object} options     — { customAiRules: string }
 * @returns {Array|null}       — array of parsed invoice objects, or null if rejected
 */

const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
const { classifyDocumentWithVision } = require('./vision_auditor.cjs');

async function runMakerCheckerLoop(fileBuffer, mime, { customAiRules = '' } = {}) {
    // Step 1: Vision classification — make sure this is actually an invoice
    const visionClass = await classifyDocumentWithVision(fileBuffer, mime);
    if (visionClass !== null && visionClass !== 'INVOICE') {
        console.log(`[MakerChecker] Vision classified as "${visionClass}" — skipping extraction.`);
        return null;
    }
    if (visionClass === null) {
        console.warn(`[MakerChecker] Vision API unavailable — proceeding with extraction anyway.`);
    }

    // Step 2: Extract invoice data via Document AI
    const parsed = await processInvoiceWithDocAI(
        fileBuffer,
        mime,
        null,                      // supervisorCritique (not used in reprocessing)
        customAiRules || null,
        null                       // vendorHint
    );

    return parsed;
}

module.exports = { runMakerCheckerLoop };
