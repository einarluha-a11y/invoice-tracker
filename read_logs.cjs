const admin = require('firebase-admin');
const serviceAccount = require('./automation/google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function readLogs() {
    const snap = await db.collection('system_logs').orderBy('createdAt', 'desc').limit(10).get();
    if (snap.empty) {
        console.log("No logs found in system_logs collection.");
        return;
    }
    snap.forEach(doc => {
        console.log(`Log [${doc.id}]:`, doc.data());
    });
}

readLogs().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
