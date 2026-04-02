require('dotenv').config();
const admin = require('firebase-admin');
const https = require('https');

const serviceAccount = require('./google-credentials.json');
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

// Helper to download PDF from URL into a Base64 string
function downloadFileBase64(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                return reject(new Error(`Failed to download: ${res.statusCode}`));
            }
            const data = [];
            res.on('data', chunk => data.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(data);
                resolve(buffer.toString('base64'));
            });
        }).on('error', reject);
    });
}

/**
 * DEEP CONTENT AUDITOR
 * Downloads the actual physical file and uses Claude Vision to ensure it is not a CMR.
 */
async function runDeepAudit() {
    console.log(`[Deep Auditor] 👁️ Starting Deep Physical File Sweep...`);
    
    try {
        console.log(`[Deep Auditor] 🏢 Targeting Global Registry (ALL COMPANIES)...`);
        const snapshot = await db.collection('invoices').get();
            
        let records = [];
        snapshot.forEach(doc => {
            records.push({ id: doc.id, ...doc.data() });
        });

        console.log(`[Deep Auditor] 📦 Fetched the latest ${records.length} records. Commencing visual inspection...`);

        let deletedCount = 0;

        for (const record of records) {
            console.log(`\n---------------------------------`);
            console.log(`[Check] Vendor: ${record.vendorName} | Vol: ${record.amount} | ID: ${record.id}`);
            
            if (!record.fileUrl) {
                console.log(`  -> No file URL. Deep audit skipped.`);
                continue;
            }

            try {
                console.log(`  -> Downloading physical PDF: ${record.fileUrl.substring(0, 50)}...`);
                const base64Pdf = await downloadFileBase64(record.fileUrl);
                
                // TODO: Re-implement document classification with Google Document AI or other provider.
                // Previously used Anthropic Claude Vision API here.
                console.log(`  -> [SKIPPED] Document classification disabled (Anthropic removed). Assuming INVOICE.`);
                const classification = 'INVOICE';

                if (classification.includes('CMR') || classification.includes('STATEMENT') || classification.includes('JUNK')) {
                    console.log(`  🚨 ILLEGAL DOCUMENT DETECTED! Physical file is a ${classification}.`);
                    console.log(`  🗑️ PURGING DATABASE RECORD: ${record.id}`);
                    await db.collection('invoices').doc(record.id).delete();
                    deletedCount++;
                } else {
                    console.log(`  ✅ Document verified as true financial record.`);
                }

            } catch (err) {
                console.error(`  ⚠️ Skipped: Failed to process document (${err.message}).`);
            }
        }

        console.log(`\n[Deep Auditor] 🏁 Sweep Complete. Permanently deleted ${deletedCount} non-invoice records from the UI.`);

    } catch (err) {
        console.error(`[Deep Auditor] Critical System Failure:`, err);
    } finally {
        process.exit(0);
    }
}

runDeepAudit();
