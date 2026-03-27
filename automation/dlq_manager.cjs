const fs = require('fs');
const path = require('path');
const dlqDir = path.join(__dirname, 'dlq');

/**
 * Serializes raw orphaned PDFs and metadata to local disk when Firebase Storage fails.
 */
function saveToDLQ(companyId, filename, buffer, extractedMetadata, reason) {
    if (!fs.existsSync(dlqDir)) {
        fs.mkdirSync(dlqDir, { recursive: true });
    }

    const uuid = Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const pdfPath = path.join(dlqDir, `${uuid}_${companyId}.pdf`);
    const jsonPath = path.join(dlqDir, `${uuid}_${companyId}.json`);

    try {
        fs.writeFileSync(pdfPath, buffer);
        fs.writeFileSync(jsonPath, JSON.stringify({
            originalFilename: filename,
            companyId,
            reason,
            extractedMetadata,
            timestamp: new Date().toISOString(),
            status: 'PENDING_UPLOAD'
        }, null, 2));

        console.log(`[DLQ] ⚠️ Cloud Storage Failed. Serialized orphaned payload to DLQ: ${uuid}`);
        return uuid;
    } catch (e) {
        console.error(`[DLQ] ❌ FATAL DISK ERROR. Failed to write to Dead Letter Queue:`, e);
        return null; // Both cloud and disk failed. Catastrophic.
    }
}

module.exports = { saveToDLQ };
