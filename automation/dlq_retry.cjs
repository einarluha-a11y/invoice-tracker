/**
 * Dead Letter Queue (DLQ) Watchdog
 * Scans the /dlq directory for orphaned Firebase Storage payloads and attempts to re-upload them.
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const dlqDir = path.join(__dirname, 'dlq');

async function processDLQ() {
    if (!fs.existsSync(dlqDir)) return;

    const files = fs.readdirSync(dlqDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    if (jsonFiles.length === 0) {
        return;
    }

    console.log(`[DLQ Watchdog] Found ${jsonFiles.length} orphaned payloads in queue.`);

    const db = admin.firestore();
    const bucket = admin.storage().bucket('invoice-tracker-xyz.firebasestorage.app');

    for (const jsonFile of jsonFiles) {
        try {
            const uuidPrefix = jsonFile.replace('.json', '');
            const pdfFile = fs.readdirSync(dlqDir).find(f => f.startsWith(uuidPrefix) && f.endsWith('.pdf'));

            if (!pdfFile) {
                console.error(`[DLQ Watchdog] Missing .pdf buffer for ${jsonFile}. Skipping.`);
                continue;
            }

            const jsonPath = path.join(dlqDir, jsonFile);
            const pdfPath = path.join(dlqDir, pdfFile);

            const dlqData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            const { companyId, originalFilename, extractedMetadata } = dlqData;
            const pdfBuffer = fs.readFileSync(pdfPath);

            console.log(`[DLQ Watchdog] Attempting recovery for AI payload: ${originalFilename}`);

            // 1. Re-attempt Firebase Storage Upload
            const uniqueName = Date.now() + '_' + (originalFilename ? originalFilename.replace(/[^a-zA-Z0-9.\-_]/g, '') : 'document.pdf');
            const storagePath = `invoices/${companyId}/${uniqueName}`;
            const file = bucket.file(storagePath);
            const uuid = require('crypto').randomUUID();

            await file.save(pdfBuffer, {
                metadata: {
                    contentType: 'application/pdf',
                    metadata: { firebaseStorageDownloadTokens: uuid }
                }
            });

            const encodedPath = encodeURIComponent(storagePath);
            const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${uuid}`;
            console.log(`[DLQ Watchdog] Recovery Upload Successful: ${fileUrl}`);

            // 2. Transmit to Firestore Safety Net
            extractedMetadata.fileUrl = fileUrl;
            extractedMetadata.companyId = companyId;
            extractedMetadata.status = 'NEEDS_REVIEW'; // Force manual review from DLQ recovery
            extractedMetadata.validationWarnings = [
                ...(extractedMetadata.validationWarnings || []),
                'DLQ_RECOVERED: This invoice was recovered from the Dead Letter Queue after a prior Firebase Storage failure.'
            ];

            const ref = await db.collection('invoices').add(extractedMetadata);
            console.log(`[DLQ Watchdog] ✅ Successfully reconciled payload to database (${ref.id}). Purging queue cache.`);

            // 3. Purge DLQ Local Cache
            fs.unlinkSync(jsonPath);
            fs.unlinkSync(pdfPath);

        } catch (e) {
            console.error(`[DLQ Watchdog] ❌ Recovery failed for ${jsonFile}:`, e.message);
        }
    }
}

// Allow autonomous execution if run directly via node
if (require.main === module) {
    if (!admin.apps.length) {
        const serviceAccount = JSON.parse(fs.readFileSync(path.join(__dirname, 'google-credentials.json'), 'utf8'));
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    }
    processDLQ().then(() => process.exit(0));
}

module.exports = { processDLQ };
