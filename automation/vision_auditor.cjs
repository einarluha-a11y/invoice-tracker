// vision_auditor.cjs — Claude-based classification DISABLED
// Returning null causes the caller to skip classification and proceed directly with extraction.
// Google Document AI handles invoice recognition internally.

async function classifyDocumentWithVision(buffer, mimeType = 'application/pdf') {
    console.log('[Vision Auditor] ℹ️  Claude classification disabled — skipping to DocAI extraction.');
    return null; // null = "skip classification, proceed with extraction" (handled in imap_daemon.cjs line 1026)
}

module.exports = { classifyDocumentWithVision };
