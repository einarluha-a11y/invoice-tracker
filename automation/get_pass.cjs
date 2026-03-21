const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function getPass() {
    const ids = ['vlhvA6i8d3Hry8rtrA3Z', 'bP6dc0PMdFtnmS5QTX4N'];
    for(let id of ids) {
        const d = await db.collection('companies').doc(id).get();
        console.log(d.data().name, d.data().imapPassword);
    }
    process.exit(0);
}
getPass();
