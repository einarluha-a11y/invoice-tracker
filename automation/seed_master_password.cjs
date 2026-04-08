/**
 * Seed master password hash into Firestore config/master_password
 * Usage: node automation/seed_master_password.cjs
 */
const admin = require('firebase-admin');
const path = require('path');

const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

const db = admin.firestore();

async function main() {
    // SHA-256 of "admin"
    const hash = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';

    await db.doc('config/master_password').set({ hash });
    console.log('✅ Master password hash seeded into config/master_password');
}

main().catch(err => { console.error(err); process.exit(1); });
