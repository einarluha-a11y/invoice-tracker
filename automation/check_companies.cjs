const admin = require('firebase-admin');
const app = admin.initializeApp({ credential: admin.credential.cert(require('./google-credentials.json')) });
const db = app.firestore();
async function run() {
    const snap = await db.collection('companies').get();
    snap.forEach(d => console.log(d.id, d.data().name));
    process.exit(0);
}
run();
