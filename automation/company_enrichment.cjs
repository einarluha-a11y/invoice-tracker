/**
 * COMPANY ENRICHMENT SERVICE
 * Rule 29: Government Source Lookup Fallback
 *
 * When AI extraction returns "Not_Found" for supplierVat or supplierRegistration,
 * this service queries official EU and Estonian government sources to fill in
 * the missing data automatically.
 *
 * Lookup chain:
 *   1. EU VIES (European VAT registry)
 *   2. Estonian Business Register (ariregister.rik.ee)
 *   3. OpenCorporates (universal fallback)
 */

require('dotenv').config({ path: __dirname + '/.env' });
const https = require('https');
const admin = require('firebase-admin');

// Ensure Firebase is initialized
if (!admin.apps.length) {
    let sa;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); } catch (e) { console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT:', e); }
    } else {
        try { sa = require('./google-credentials.json'); } catch (e) { console.error('google-credentials.json not found.'); }
    }
    if (sa) admin.initializeApp({ credential: admin.credential.cert(sa) });
}
// Guard: only call firestore() when Firebase was successfully initialized.
const db = admin.apps.length ? admin.firestore() : null;

const CACHE_COLLECTION = 'companies_cache';

/** Normalize vendor name for consistent cache key */
function normalizeVendorName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/\boü\b|\bas\b|\bllc\b|\bltd\b|\binc\b|\buab\b|\bsia\b/gi, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

/** Simple HTTPS GET returning parsed JSON (8s timeout prevents pipeline hangs on slow registries) */
function httpsGet(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'InvoiceTracker/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve(null); }
            });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error(`httpsGet timeout after ${timeoutMs}ms`));
        });
    });
}

/** Fuzzy match: does name A overlap with name B after normalization? */
function fuzzyMatch(a, b) {
    const na = normalizeVendorName(a);
    const nb = normalizeVendorName(b);
    return na.length > 3 && nb.length > 3 && (na.includes(nb) || nb.includes(na));
}

/**
 * Stage 1: Query EU VIES for VAT number using company name + country hint.
 * VIES search API: https://ec.europa.eu/taxation_customs/vies/rest-api
 */
async function lookupViaVIES(vendorName, countryCode) {
    if (!countryCode || countryCode.length !== 2) return null;
    try {
        // VIES doesn't have a name-search endpoint, but we can try known patterns
        // For Estonian companies: EE + 9 digits. We'll rely on ariregister for the actual number.
        console.log(`[Enrichment] VIES lookup skipped for name search (use ariregister for EE companies)`);
        return null;
    } catch (e) {
        console.warn(`[Enrichment] VIES error:`, e.message);
        return null;
    }
}

/**
 * Stage 2: Query Estonian Business Register (ariregister.rik.ee)
 * Returns { vatNumber, registrationNumber } or null.
 */
async function lookupViaAriregister(vendorName) {
    try {
        const query = encodeURIComponent(vendorName.replace(/OÜ|AS|Ltd/gi, '').trim());
        const url = `https://ariregister.rik.ee/api/companies?q=${query}&lang=eng`;
        console.log(`[Enrichment] Querying Estonian Business Register for: ${vendorName}`);
        const data = await httpsGet(url);
        if (!data || !Array.isArray(data)) return null;

        for (const company of data) {
            const name = company.nimi || company.name || '';
            if (fuzzyMatch(vendorName, name)) {
                console.log(`[Enrichment] ✅ ariregister match: "${name}" (reg: ${company.ariregistri_kood}, kmkr: ${company.kmkr_nr})`);
                return {
                    registrationNumber: company.ariregistri_kood || null,
                    vatNumber: company.kmkr_nr ? `EE${company.kmkr_nr}` : null,
                    source: 'ariregister',
                    matchedName: name
                };
            }
        }
        console.log(`[Enrichment] ariregister: no fuzzy match found for "${vendorName}"`);
        return null;
    } catch (e) {
        console.warn(`[Enrichment] ariregister error:`, e.message);
        return null;
    }
}

/**
 * Stage 2b: Query Polish company register (KRS API) for Polish Sp. z o.o. / S.A. companies
 */
async function lookupViaKRS(vendorName) {
    try {
        const query = encodeURIComponent(vendorName.replace(/Sp\.?\s*z\s*o\.?o\.?|S\.A\.|sp\. z o\.o\./gi, '').trim());
        const url = `https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/wyszukaj?nazwa=${query}&forma=P&rejestry=P`;
        console.log(`[Enrichment] Querying Polish KRS for: ${vendorName}`);
        const data = await httpsGet(url);
        if (!data || !data.odpis || !Array.isArray(data.odpis)) return null;

        for (const company of data.odpis) {
            const name = company.naglowekA?.firma || '';
            if (fuzzyMatch(vendorName, name)) {
                const nip = company.naglowekA?.nip || null;
                const krs = company.naglowekA?.numerKRS || null;
                console.log(`[Enrichment] ✅ KRS match: "${name}" (NIP: ${nip}, KRS: ${krs})`);
                return {
                    registrationNumber: krs || null,
                    vatNumber: nip ? `PL${nip}` : null,
                    source: 'krs-poland',
                    matchedName: name
                };
            }
        }
        return null;
    } catch (e) {
        console.warn(`[Enrichment] KRS Poland error:`, e.message);
        return null;
    }
}

/**
 * Stage 3: Query OpenCorporates as universal fallback.
 * Supports jurisdiction codes: ee (Estonia), lv (Latvia), lt (Lithuania), etc.
 */
async function lookupViaOpenCorporates(vendorName, jurisdictionCode) {
    try {
        const jCode = (jurisdictionCode || 'ee').toLowerCase();
        const query = encodeURIComponent(vendorName.replace(/OÜ|AS|UAB|SIA|Ltd/gi, '').trim());
        const url = `https://api.opencorporates.com/v0.4/companies/search?q=${query}&jurisdiction_code=${jCode}&per_page=5`;
        console.log(`[Enrichment] Querying OpenCorporates (${jCode}) for: ${vendorName}`);
        const data = await httpsGet(url);
        const companies = data?.results?.companies || [];

        for (const item of companies) {
            const co = item.company;
            if (fuzzyMatch(vendorName, co.name || '')) {
                console.log(`[Enrichment] ✅ OpenCorporates match: "${co.name}" (reg: ${co.company_number})`);
                return {
                    registrationNumber: co.company_number || null,
                    vatNumber: null,  // OpenCorporates doesn't always have VAT numbers
                    source: 'opencorporates',
                    matchedName: co.name
                };
            }
        }
        console.log(`[Enrichment] OpenCorporates: no match for "${vendorName}"`);
        return null;
    } catch (e) {
        console.warn(`[Enrichment] OpenCorporates error:`, e.message);
        return null;
    }
}

/**
 * Main entry point: enrich a vendor's VAT and registration number.
 * @param {string} vendorName - Vendor name from invoice
 * @param {string} countryHint - 2-letter country code hint (e.g. 'EE', 'LV', 'LT')
 * @returns {{ vatNumber, registrationNumber, source, matchedName } | null}
 */
async function enrichCompanyData(vendorName, countryHint = 'EE') {
    if (!vendorName || vendorName === 'Unknown') return null;

    const cacheKey = normalizeVendorName(vendorName);

    // 1. Check Firestore cache first (skip if Firebase not initialized)
    try {
        if (!db) throw new Error('db_unavailable');
        const cached = await db.collection(CACHE_COLLECTION).doc(cacheKey).get();
        if (cached.exists) {
            const data = cached.data();
            // Handle Firestore Timestamp, JS Date, raw millisecond number, or missing field
            const ca = data.cachedAt;
            const cachedAtMs = typeof ca?.toMillis === 'function' ? ca.toMillis()
                             : ca instanceof Date               ? ca.getTime()
                             : typeof ca === 'number'           ? ca
                             : 0;
            const ageHours = (Date.now() - cachedAtMs) / 3600000;
            if (ageHours < 720) { // Cache valid for 30 days
                console.log(`[Enrichment] Cache hit for "${vendorName}" (source: ${data.source})`);
                return data;
            }
        }
    } catch (e) {
        console.warn(`[Enrichment] Cache read error:`, e.message);
    }

    // 2. Run lookup chain
    let result = null;
    const cc = (countryHint || '').toUpperCase();

    // Stage 1: VIES (limited for name search — mainly for validation)
    result = await lookupViaVIES(vendorName, cc);

    // Stage 2: Estonian Business Register (for EE companies)
    if (!result && (cc === 'EE' || vendorName.match(/OÜ|AS\b/i))) {
        result = await lookupViaAriregister(vendorName);
    }

    // Stage 2b: Polish KRS (for Sp. z o.o. / S.A. companies)
    if (!result && (cc === 'PL' || vendorName.match(/Sp\.?\s*z\s*o\.?o\.?|S\.A\./i))) {
        result = await lookupViaKRS(vendorName);
    }

    // Stage 3: OpenCorporates (universal fallback)
    if (!result) {
        const jCode = {
            'EE': 'ee', 'LV': 'lv', 'LT': 'lt', 'FI': 'fi', 'SE': 'se', 'PL': 'pl',
            'DE': 'de', 'FR': 'fr', 'NL': 'nl', 'BE': 'be', 'AT': 'at', 'IT': 'it',
            'ES': 'es', 'PT': 'pt', 'HU': 'hu', 'CZ': 'cz', 'SK': 'sk', 'RO': 'ro',
            'BG': 'bg', 'HR': 'hr', 'SI': 'si', 'DK': 'dk', 'NO': 'no', 'GB': 'gb',
            'IE': 'ie', 'UA': 'ua', 'BY': 'by', 'RU': 'ru'
        }[cc] || null;
        // Only query OpenCorporates if we have a plausible jurisdiction code
        if (jCode) {
            result = await lookupViaOpenCorporates(vendorName, jCode);
        } else {
            console.log(`[Enrichment] No OpenCorporates jurisdiction mapping for country "${cc}" — skipping.`);
        }
    }

    if (!result) {
        console.log(`[Enrichment] ❌ All sources exhausted for "${vendorName}". Writing Not_Found.`);
        return null;
    }

    // 3. Cache the result (skip if Firebase not initialized)
    try {
        if (!db) throw new Error('db_unavailable');
        await db.collection(CACHE_COLLECTION).doc(cacheKey).set({
            ...result,
            vendorName,
            cachedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[Enrichment] Cached result for "${vendorName}"`);
    } catch (e) {
        console.warn(`[Enrichment] Cache write error:`, e.message);
    }

    return result;
}

module.exports = { enrichCompanyData };
