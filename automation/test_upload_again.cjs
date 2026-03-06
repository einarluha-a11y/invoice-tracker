const admin = require('firebase-admin');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'invoice-tracker-xyz.firebasestorage.app'
});

async function run() {
  try {
    const bucket = admin.storage().bucket();
    const token = uuidv4();
    const file = bucket.file('invoices/test.txt');
    await file.save('Hello world', {
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      contentType: 'text/plain'
    });
    console.log("Success! File URL:", `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${token}`);
  } catch (e) {
    console.error("Error:", e.message);
  }
}
run();
