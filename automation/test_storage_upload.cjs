require("dotenv").config();
const fs = require('fs');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: 'invoice-tracker-xyz.appspot.com'
    });
}
const bucket = admin.storage().bucket();

async function testUpload() {
    const crypto = require('crypto');
    const fileName = "test_upload.pdf";
    const companyId = "test_company";
    const uniqueName = Date.now() + '_' + fileName;
    const filePath = `invoices/${companyId}/${uniqueName}`;
    const file = bucket.file(filePath);
    
    const uuid = crypto.randomUUID();

    try {
        await file.save("dummy pdf content", {
            metadata: {
                contentType: "application/pdf",
                metadata: {
                    firebaseStorageDownloadTokens: uuid
                }
            }
        });

        const encodedPath = encodeURIComponent(filePath);
        const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${uuid}`;
        console.log("SUCCESS! URL:", url);
    } catch (e) {
        console.error("FAILED TO UPLOAD:", e);
    }
}
testUpload();
