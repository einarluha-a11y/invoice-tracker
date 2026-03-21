const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function fixPronto() {
    try {
        const pronto = await db.collection('invoices').doc('4y2r0ukzhLw5iT9dgFbl').get();
        await db.collection('invoices').doc('DCRe770vZL19AoclWWp9').update({ fileUrl: pronto.data().fileUrl });
        console.log('Fixed Pronto');
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}
fixPronto();
