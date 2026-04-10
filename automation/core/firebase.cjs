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
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'invoice-tracker-xyz.firebasestorage.app'
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
if (db) db.settings({ preferRest: true }); // REST API: cold start 1-2s vs gRPC 8-12s
const bucket = admin.apps.length ? admin.storage().bucket() : null;

// ─── Global AI Rules (cached) ───────────────────────────────────────────────
// Single source of truth: config/global_ai_rules document in Firestore.
// All agents read from here. Auto-learning writes here.
let _cachedRules = null;
let _cachedAt = 0;
const RULES_CACHE_TTL = 60000; // 60 seconds

async function getGlobalAiRules() {
    if (!db) return '';
    if (_cachedRules !== null && Date.now() - _cachedAt < RULES_CACHE_TTL) {
        return _cachedRules;
    }
    try {
        const snap = await db.collection('config').doc('global_ai_rules').get();
        _cachedRules = snap.exists ? (snap.data().customAiRules || '') : '';
        _cachedAt = Date.now();
        return _cachedRules;
    } catch (err) {
        console.warn('[Firebase Core] Failed to load global AI rules:', err.message);
        return _cachedRules || '';
    }
}

/** Сбрасывает кэш AI-правил немедленно. Вызывается из api_server при изменении Settings. */
function invalidateRulesCache() {
    _cachedRules = null;
    _cachedAt = 0;
    console.log('[Firebase Core] 🔄 Rules cache invalidated');
}

module.exports = { admin, db, bucket, serviceAccount: sa, getGlobalAiRules, invalidateRulesCache };
