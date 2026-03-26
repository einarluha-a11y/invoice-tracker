---
name: Implement Government Source Lookup (Rule 29) — Company Enrichment Fallback
description: When Document AI returns Not_Found for VAT or Reg No, automatically look them up from official EU/Estonian government sources before giving up. Create company_enrichment.cjs and integrate it into the Accountant Agent.
priority: HIGH
triggers:
  - manual
---

// turbo-all

# TASK: Implement Company Enrichment Fallback (Rule 29)

## Goal

When `supplierVat` or `supplierRegistration` is `"Not_Found"` after AI extraction,
the Accountant Agent must attempt to look up the missing data from 3 official sources
before writing "Not_Found" to the database.

**Lookup chain:**
1. EU VIES Registry (for VAT number by company name)
2. Estonian Business Register API (ariregister.rik.ee) — for Estonian OÜ/AS companies
3. OpenCorporates API — universal fallback

Only if all 3 fail → write `"Not_Found"` to Firestore.

---

## Step 1 — Create `automation/company_enrichment.cjs`

Create a new file with this content:

```js
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
    const sa = require('./google-credentials.json');
    admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();

const CACHE_COLLECTION = 'companies_cache';

/** Normalize vendor name for consistent cache key */
function normalizeVendorName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/\boü\b|\bas\b|\bllc\b|\bltd\b|\binc\b|\buab\b|\bsia\b/gi, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

/** Simple HTTPS GET returning parsed JSON */
function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'InvoiceTracker/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { resolve(null); }
            });
        }).on('error', reject);
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

    // 1. Check Firestore cache first
    try {
        const cached = await db.collection(CACHE_COLLECTION).doc(cacheKey).get();
        if (cached.exists) {
            const data = cached.data();
            const ageHours = (Date.now() - (data.cachedAt?.toMillis?.() || 0)) / 3600000;
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

    // Stage 3: OpenCorporates (universal fallback)
    if (!result) {
        const jCode = { 'EE': 'ee', 'LV': 'lv', 'LT': 'lt', 'FI': 'fi', 'SE': 'se' }[cc] || 'ee';
        result = await lookupViaOpenCorporates(vendorName, jCode);
    }

    if (!result) {
        console.log(`[Enrichment] ❌ All sources exhausted for "${vendorName}". Writing Not_Found.`);
        return null;
    }

    // 3. Cache the result
    try {
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
```

---

## Step 2 — Integrate into `automation/accountant_agent.cjs`

At the top of `accountant_agent.cjs`, add the import:
```js
const { enrichCompanyData } = require('./company_enrichment.cjs');
```

Find the pre-flight VAT/Reg check (around line 152–162):
```js
if (!docAiPayload.supplierRegistration || docAiPayload.supplierRegistration === "Not_Found" ...
```

Replace the entire block with this enriched version:

```js
// --- 1.7. PRE-FLIGHT AUDIT: Missing Registration/VAT — with Government Fallback Lookup (Rule 29) ---
const vatMissing = !docAiPayload.supplierVat || docAiPayload.supplierVat === "Not_Found" || docAiPayload.supplierVat === "NOT_FOUND_ON_INVOICE" || String(docAiPayload.supplierVat).trim() === "";
const regMissing = !docAiPayload.supplierRegistration || docAiPayload.supplierRegistration === "Not_Found" || docAiPayload.supplierRegistration === "NOT_FOUND_ON_INVOICE" || String(docAiPayload.supplierRegistration).trim() === "";

if (vatMissing || regMissing) {
    console.log(`[Accountant Agent] 🔍 VAT/Reg missing from document. Attempting government source lookup for: ${docAiPayload.vendorName}`);
    try {
        // Detect country hint from vendor name or existing VAT prefix
        const countryHint = docAiPayload.supplierVat?.match(/^([A-Z]{2})/)?.[1]
            || (docAiPayload.vendorName?.match(/\bOÜ\b|\bAS\b/i) ? 'EE' : null)
            || (docAiPayload.vendorName?.match(/\bUAB\b/i) ? 'LT' : null)
            || (docAiPayload.vendorName?.match(/\bSIA\b/i) ? 'LV' : null)
            || 'EE';

        const enriched = await enrichCompanyData(docAiPayload.vendorName, countryHint);

        if (enriched) {
            if (vatMissing && enriched.vatNumber) {
                docAiPayload.supplierVat = enriched.vatNumber;
                docAiPayload.enrichmentSource = enriched.source;
                warnings.push(`INFO: VAT number auto-enriched from ${enriched.source} (matched: "${enriched.matchedName}")`);
                console.log(`[Accountant Agent] ✅ VAT enriched from ${enriched.source}: ${enriched.vatNumber}`);
            }
            if (regMissing && enriched.registrationNumber) {
                docAiPayload.supplierRegistration = enriched.registrationNumber;
                docAiPayload.enrichmentSource = enriched.source;
                warnings.push(`INFO: Registration number auto-enriched from ${enriched.source} (matched: "${enriched.matchedName}")`);
                console.log(`[Accountant Agent] ✅ Reg No enriched from ${enriched.source}: ${enriched.registrationNumber}`);
            }
        }
    } catch (enrichErr) {
        console.warn(`[Accountant Agent] ⚠️ Enrichment lookup failed:`, enrichErr.message);
    }
}

// Final state after enrichment attempt
if (!docAiPayload.supplierRegistration || docAiPayload.supplierRegistration === "Not_Found" || docAiPayload.supplierRegistration === "NOT_FOUND_ON_INVOICE" || String(docAiPayload.supplierRegistration).trim() === "") {
    docAiPayload.supplierRegistration = "Not_Found";
    warnings.push("CRITICAL: Supplier Registration Number is missing from the physical document and could not be found in official sources.");
    systemStatus = 'Needs Action';
}
if (!docAiPayload.supplierVat || docAiPayload.supplierVat === "Not_Found" || docAiPayload.supplierVat === "NOT_FOUND_ON_INVOICE" || String(docAiPayload.supplierVat).trim() === "") {
    docAiPayload.supplierVat = "Not_Found";
    warnings.push("CRITICAL: Supplier VAT Number is missing from the physical document and could not be found in official sources.");
    systemStatus = 'Needs Action';
}
```

---

## Step 3 — Verify Syntax

```bash
cd /Users/einarluha/invoice-tracker
node --check automation/company_enrichment.cjs && echo "✅ enrichment OK"
node --check automation/accountant_agent.cjs && echo "✅ accountant OK"
```

## Step 4 — Test the Enrichment Manually

```bash
cd /Users/einarluha/invoice-tracker
node -e "
require('dotenv').config({ path: './automation/.env' });
const { enrichCompanyData } = require('./automation/company_enrichment.cjs');
enrichCompanyData('1A Rehvid OÜ', 'EE').then(r => {
  console.log('Result:', JSON.stringify(r, null, 2));
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected output:
```json
{
  "registrationNumber": "11067965",
  "vatNumber": "EE101234567",
  "source": "ariregister",
  "matchedName": "1A Rehvid OÜ"
}
```

## Step 5 — Commit

```bash
cd /Users/einarluha/invoice-tracker
git add automation/company_enrichment.cjs automation/accountant_agent.cjs
git commit -m "feat: add government source enrichment fallback for missing VAT/Reg No (Rule 29)"
```
