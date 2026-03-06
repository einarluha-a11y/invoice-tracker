require("dotenv").config();
const fs = require('fs');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

async function listBuckets() {
    try {
        const [buckets] = await admin.storage().getBuckets();
        console.log("Found buckets:", buckets.map(b => b.name));
    } catch (e) {
        console.error("Error listing buckets:", e);
    }
}
listBuckets();
