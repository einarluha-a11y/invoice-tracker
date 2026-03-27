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
    try {
        admin.initializeApp({
            credential: admin.credential.cert(sa),
            storageBucket: 'invoice-tracker-xyz.firebasestorage.app'
        });
        console.log('[Firebase Core] ✅ Initialized successfully.');
    } catch (e) {
        // Credential object is invalid (e.g. malformed private_key) — log and continue.
        // All callers guard against admin.apps.length === 0, so the app won't crash.
        console.error('[Firebase Core] ❌ initializeApp failed:', e.message);
    }
}

// Guard abstractions: prevent uninitialized firestore calls from crashing Express/PM2 loops
const db = admin.apps.length ? admin.firestore() : null;
const bucket = admin.apps.length ? admin.storage().bucket() : null;

module.exports = { admin, db, bucket, serviceAccount: sa };
