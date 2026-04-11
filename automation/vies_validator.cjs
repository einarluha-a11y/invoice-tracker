const https = require('https');

// ── Two-tier VIES cache (M8) ────────────────────────────────────────────────
// 1. In-memory Map: hot cache, sub-millisecond, lost on container restart
// 2. Firestore `vies_cache` collection: persistent across deploys, survives
//    Railway redeploys, shared between PM2 workers
//
// Lookup order: in-memory → Firestore → live VIES API call.
// On every successful API call we backfill BOTH layers.
//
// TTL is 24h for the persistent layer (matches the audit Phase 2 spec) and
// 7 days for the in-memory layer because hot lookups in a single process
// don't need to re-check Firestore that often.
const _memCache = new Map();
const MEM_CACHE_TTL  = 7 * 24 * 60 * 60 * 1000;
const FIRE_CACHE_TTL = 24 * 60 * 60 * 1000;

// Lazy Firestore handle — vies_validator.cjs is sometimes required by
// scripts that don't initialise firebase-admin (e.g. lightweight CLI tools),
// so we tolerate the require() failing and degrade to memory-only.
let _db = null;
let _fbInitTried = false;
function getDb() {
    if (_fbInitTried) return _db;
    _fbInitTried = true;
    try {
        const fb = require('./core/firebase.cjs');
        _db = fb.db || null;
    } catch (e) {
        // No firebase available — caller is a lightweight tool, just use memory cache.
        _db = null;
    }
    return _db;
}

function normalizeVat(fullVatCode) {
    return (fullVatCode || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

async function readFirestoreCache(cacheKey) {
    const db = getDb();
    if (!db) return null;
    try {
        const snap = await db.collection('vies_cache').doc(cacheKey).get();
        if (!snap.exists) return null;
        const d = snap.data();
        const cachedAt = d.cachedAt && d.cachedAt.toMillis ? d.cachedAt.toMillis() : d.cachedAt;
        if (!cachedAt || (Date.now() - cachedAt) > FIRE_CACHE_TTL) return null;
        return {
            isValid: d.isValid === true,
            name: d.name || null,
            address: d.address || null,
            error: d.error || null,
        };
    } catch (e) {
        // Firestore read failure is non-blocking — fall through to live API call.
        return null;
    }
}

async function writeFirestoreCache(cacheKey, result) {
    const db = getDb();
    if (!db) return;
    if (result.error) return; // never persist error responses
    try {
        const admin = require('firebase-admin');
        await db.collection('vies_cache').doc(cacheKey).set({
            isValid: result.isValid === true,
            name: result.name || null,
            address: result.address || null,
            cachedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {
        // Non-blocking — caching is a best-effort optimisation.
    }
}

/**
 * Validates a European VAT number against the official European Commission VIES REST API.
 * Two-tier cache: in-memory (7d) + Firestore vies_cache (24h, persistent).
 *
 * @param {string} fullVatCode - Full VAT string starting with 2-letter country code (e.g. "EE101662580").
 * @returns {Promise<Object>} { isValid, name, address, error }
 */
async function validateVat(fullVatCode) {
    if (!fullVatCode || typeof fullVatCode !== 'string' || fullVatCode.length < 4) {
        return { isValid: false, name: null, error: 'Invalid Format' };
    }

    const cacheKey = normalizeVat(fullVatCode);

    // Tier 1: in-memory hot cache
    const memHit = _memCache.get(cacheKey);
    if (memHit && Date.now() - memHit.time < MEM_CACHE_TTL) {
        return memHit.result;
    }

    // Tier 2: Firestore persistent cache
    const fireHit = await readFirestoreCache(cacheKey);
    if (fireHit) {
        // Promote to memory for next call
        _memCache.set(cacheKey, { result: fireHit, time: Date.now() });
        return fireHit;
    }

    // Cache miss → live VIES call
    const result = await new Promise((resolve) => {
        const cleanVat = cacheKey;
        const countryCode = cleanVat.substring(0, 2);
        const vatNumber = cleanVat.substring(2);

        const payload = JSON.stringify({
            countryCode: countryCode,
            vatNumber: vatNumber,
        });

        const options = {
            hostname: 'ec.europa.eu',
            port: 443,
            path: '/taxation_customs/vies/rest-api/check-vat-number',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        return resolve({
                            isValid: json.valid === true || json.isValid === true,
                            name: json.name || null,
                            address: json.address || null,
                            error: null,
                        });
                    } catch (e) {
                        return resolve({ isValid: false, name: null, error: 'JSON Parse Error from VIES' });
                    }
                } else {
                    return resolve({ isValid: false, name: null, error: `VIES API Error: ${res.statusCode}` });
                }
            });
        });

        req.on('error', (e) => {
            console.error(`[VIES API Error] ${e.message}`);
            return resolve({ isValid: false, name: null, error: 'Network Error connecting to VIES' });
        });

        req.setTimeout(5000, () => {
            req.destroy();
            return resolve({ isValid: false, name: null, error: 'VIES API Timeout' });
        });

        req.write(payload);
        req.end();
    });

    // Backfill both cache layers on success
    if (!result.error) {
        _memCache.set(cacheKey, { result, time: Date.now() });
        // Fire-and-forget Firestore write — don't block the caller
        writeFirestoreCache(cacheKey, result).catch(() => {});
    }

    return result;
}

module.exports = { validateVat };
