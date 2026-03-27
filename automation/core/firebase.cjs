const admin = require('firebase-admin');
const path = require('path');

let sa;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try { 
        sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); 
    } catch (e) { 
        console.error('[Firebase Core] Failed to parse FIREBASE_SERVICE_ACCOUNT from ENV:', e.message); 
    }
} else {
    try { 
        sa = require(path.join(__dirname, '..', 'google-credentials.json')); 
    } catch (e) { 
        console.error('[Firebase Core] google-credentials.json not found. Set FIREBASE_SERVICE_ACCOUNT env var.'); 
    }
}

if (!admin.apps.length && sa) {
    admin.initializeApp({
        credential: admin.credential.cert(sa),
        storageBucket: 'invoice-tracker-xyz.firebasestorage.app'
    });
}

// Guard abstractions: prevent uninitialized firestore calls from crashing Express/PM2 loops
const db = admin.apps.length ? admin.firestore() : null;
const bucket = admin.apps.length ? admin.storage().bucket() : null;

module.exports = { admin, db, bucket, serviceAccount: sa };
