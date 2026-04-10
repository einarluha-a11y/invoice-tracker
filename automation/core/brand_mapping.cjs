/**
 * Brand → Legal Entity Mapping
 *
 * Problem: marketing brand on an invoice (e.g. "Kookon Nutilaod", "Bolt", "Wolt")
 * almost never equals the legal entity we need in accounting ("Allstore Assets OÜ",
 * "Bolt Operations OÜ", "Wolt Enterprises Eesti OÜ"). Teacher's token-overlap
 * example lookup fails on these because the strings share zero characters.
 *
 * Solution: a Firestore-backed lookup table `brand_aliases` that maps the
 * marketing name (as printed on the invoice) to the legal entity, optionally
 * along with regCode / VAT for cross-verification.
 *
 * Schema of each `brand_aliases` document:
 *   {
 *     brand: "Kookon Nutilaod",         // case preserved, match is case-insensitive
 *     legalName: "Allstore Assets OÜ",  // what Teacher should use as vendorName
 *     regCode: "16234567",              // optional — if present, stamped onto invoice
 *     vatNumber: "EE102530000",         // optional — ditto
 *     source: "manual" | "teacher",     // how the alias was added
 *     createdAt: serverTimestamp()
 *   }
 *
 * Cache: aliases are read once per process and held for BRAND_CACHE_TTL ms.
 * Cache can be manually busted via `invalidateBrandCache()` — call after a
 * user adds a new alias through the Settings UI.
 *
 * Used by: teacher_agent.cjs (inside validateAndTeach, before example lookup)
 */

'use strict';

const BRAND_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
let _cache = null;
let _cacheAt = 0;
let _cacheSize = 0;

/**
 * Normalize a brand string for lookup: lowercase + collapse whitespace +
 * strip quotes/punctuation. Identical function is used on both the stored
 * brand and the incoming invoice's vendorName so matches are symmetric.
 */
function normalizeBrand(s) {
    if (!s) return '';
    return String(s)
        .toLowerCase()
        .replace(/[\u0022\u201C\u201D\u201E\u201F\u00AB\u00BB]/g, '') // quotes
        .replace(/[.,;:!?()\[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Load all `brand_aliases` from Firestore into an in-memory map.
 * Map key = normalized brand; map value = full alias doc.
 */
async function loadBrandAliases(db) {
    if (!db) return new Map();

    const now = Date.now();
    if (_cache && (now - _cacheAt) < BRAND_CACHE_TTL) {
        return _cache;
    }

    const map = new Map();
    try {
        const snap = await db.collection('brand_aliases').get();
        for (const doc of snap.docs) {
            const d = doc.data();
            if (!d || !d.brand || !d.legalName) continue;
            const key = normalizeBrand(d.brand);
            if (!key) continue;
            map.set(key, {
                brand: d.brand,
                legalName: d.legalName,
                regCode: d.regCode || '',
                vatNumber: d.vatNumber || '',
                source: d.source || 'manual',
                _docId: doc.id,
            });
        }
    } catch (err) {
        console.warn(`[BrandMapping] Failed to load brand_aliases: ${err.message}`);
        // Return whatever we managed to load — empty map is fine (no-op lookup).
    }

    _cache = map;
    _cacheAt = now;
    _cacheSize = map.size;
    return map;
}

/**
 * Look up a legal entity by marketing brand.
 * Matches in this order:
 *   1. Exact normalized match                   ("kookon nutilaod" ➝ ...)
 *   2. Brand is substring of vendorName          ("Bolt Technology OÜ" contains "bolt")
 *   3. vendorName is substring of brand          ("Wolt" inside "Wolt Enterprises Eesti OÜ")
 *
 * Returns the alias record, or null if nothing matched.
 *
 * The substring fallbacks are important for cases where the invoice prints
 * the brand as part of a longer composite string — but we require the brand
 * to be at least 4 chars so we don't match junk like "at" or "is".
 */
async function findLegalEntityByBrand(db, vendorName) {
    if (!vendorName) return null;
    const aliases = await loadBrandAliases(db);
    if (aliases.size === 0) return null;

    const normVendor = normalizeBrand(vendorName);
    if (!normVendor) return null;

    // 1. Exact match
    if (aliases.has(normVendor)) {
        return aliases.get(normVendor);
    }

    // 2. Any stored brand that is a substring of the incoming vendor name.
    //    Longest brand wins — "Kookon Nutilaod" beats "Kookon" on a fuller string.
    let best = null;
    let bestLen = 0;
    for (const [key, val] of aliases) {
        if (key.length < 4) continue;
        if (normVendor.includes(key) && key.length > bestLen) {
            best = val;
            bestLen = key.length;
        }
    }
    if (best) return best;

    // 3. Reverse: vendor name is a substring of a stored brand
    //    (happens when invoice prints only the short brand and the legal
    //    entity is stored as the longer composite). Again longest wins.
    for (const [key, val] of aliases) {
        if (key.length < 4) continue;
        if (key.includes(normVendor) && normVendor.length >= 4) {
            if (!best || key.length > bestLen) {
                best = val;
                bestLen = key.length;
            }
        }
    }

    return best;
}

/**
 * Bust the in-memory cache. Call after a user adds/edits/deletes a brand
 * alias through the Settings UI, so the Teacher picks it up on the next
 * invoice without waiting for the 30-min TTL.
 */
function invalidateBrandCache() {
    _cache = null;
    _cacheAt = 0;
    _cacheSize = 0;
}

/**
 * Diagnostic helper — returns cache state for logging.
 */
function getBrandCacheStats() {
    return {
        loaded: _cache !== null,
        size: _cacheSize,
        ageMs: _cache ? (Date.now() - _cacheAt) : 0,
        ttlMs: BRAND_CACHE_TTL,
    };
}

module.exports = {
    findLegalEntityByBrand,
    loadBrandAliases,
    normalizeBrand,
    invalidateBrandCache,
    getBrandCacheStats,
    BRAND_CACHE_TTL,
};
