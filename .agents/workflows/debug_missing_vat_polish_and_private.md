---
name: Debug — Missing VAT/Reg for Polish Companies and Private Persons
description: Invoices from Terma Sp. z o.o. (Poland) and DMYTRO SUPRUN (private person) are missing VAT and registration numbers. Extend Baltic protocol to cover Polish companies and handle private person invoices correctly.
priority: URGENT
triggers:
  - manual
---

// turbo-all

# TASK: Fix Missing VAT/Reg for Polish Companies and Private Persons

## Context

Two new invoices appeared with likely missing VAT and Reg No:
1. **Terma Sp. z o.o.** — Polish company. Poland uses "NIP" for VAT and "KRS" or "REGON" for registration.
2. **DMYTRO SUPRUN** — Appears to be a private person or sole trader (FOP/ФОП). May legitimately have no VAT number.

The Document AI prompt currently only has hints for Estonian, Latvian, and Lithuanian companies. Polish companies and private persons are not covered.

---

## Step 1 — Check What Was Actually Extracted

Run in terminal to see the current Firestore records:
```bash
cd /Users/einarluha/invoice-tracker
node -e "
require('dotenv').config({ path: './automation/.env' });
const admin = require('./automation/node_modules/firebase-admin');
const sa = require('./automation/google-credentials.json');
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(sa) });
admin.firestore().collection('invoices').orderBy('createdAt', 'desc').limit(5).get().then(snap => {
  snap.forEach(d => {
    const data = d.data();
    console.log('---');
    console.log('Vendor:', data.vendorName);
    console.log('supplierVat:', data.supplierVat);
    console.log('supplierRegistration:', data.supplierRegistration);
    console.log('fileUrl:', data.fileUrl ? 'YES' : 'MISSING');
    console.log('status:', data.status);
    console.log('warnings:', JSON.stringify(data.validationWarnings));
  });
  process.exit(0);
});
"
```

---

## Step 2 — Fix the Document AI Prompt for Polish Companies

Open `automation/document_ai_service.cjs` and find the LOCALIZATION HINTS section (Rule 23 area):

```
3. LANGUAGE & LOCALIZATION HINTS: Baltic invoices are critical...
```

Extend the section to also cover Polish companies. Add after the Lithuanian line:

```
  - **Polish (Sp. z o.o. / S.A.)**: `supplierVat` = look for "NIP" followed by 10 digits, often formatted as PL + 10 digits (e.g. PL1234567890) or with dashes (123-456-78-90). `supplierRegistration` = look for "KRS" followed by a 10-digit number, or "REGON" followed by a 9-digit number. Both are usually in the invoice header or footer.
  - **Ukrainian (ТОВ / ФОП / private persons)**: If the vendor is a private person (first name + last name, no company suffix), they may use a personal tax ID called "ІПН" or "ЄДРПОУ" (8-10 digits). If no tax number exists on the document, output Not_Found — do NOT invent one.
  - **General rule for private persons**: If the vendor name appears to be a human name (two words, no company suffix like OÜ/AS/Ltd/GmbH/Sp.z o.o.), set `supplierRegistration` and `supplierVat` to Not_Found unless explicitly printed on the document. Private persons are not required to have VAT numbers.
```

---

## Step 3 — Fix the Accountant Agent for Private Persons

In `automation/accountant_agent.cjs`, the pre-flight audit currently flags missing VAT/Reg as "CRITICAL" and sets status to "Needs Action" for ALL invoices.

This is too aggressive for private persons and freelancers who legitimately have no VAT number.

Find the section around line 153–162 that checks for missing VAT/Reg. Add a private person detection check BEFORE the critical warnings:

```js
// --- 1.7. PRE-FLIGHT AUDIT: Missing Registration/VAT ---
// Check if vendor appears to be a private person (no company suffix)
const companyMarkers = /\b(OÜ|AS|Ltd|LLC|GmbH|SIA|UAB|Sp\.?\s*z\s*o\.?o\.?|S\.A\.|Inc|Corp|BV|NV|SRL|SARL|GmbH)\b/i;
const isPrivatePerson = !companyMarkers.test(docAiPayload.vendorName || '');

if (isPrivatePerson) {
    console.log(`[Accountant Agent] 👤 Vendor "${docAiPayload.vendorName}" appears to be a private person. VAT/Reg may not be required.`);
    // For private persons: missing VAT/Reg is a NOTE, not a CRITICAL error
    if (!docAiPayload.supplierVat || docAiPayload.supplierVat === "Not_Found" || docAiPayload.supplierVat === "NOT_FOUND_ON_INVOICE") {
        docAiPayload.supplierVat = "Not_Found";
        warnings.push("NOTE: Vendor appears to be a private person — VAT number may not be required.");
    }
    if (!docAiPayload.supplierRegistration || docAiPayload.supplierRegistration === "Not_Found" || docAiPayload.supplierRegistration === "NOT_FOUND_ON_INVOICE") {
        docAiPayload.supplierRegistration = "Not_Found";
        warnings.push("NOTE: Vendor appears to be a private person — registration number may not be required.");
    }
} else {
    // Company: run enrichment lookup (Rule 29) then apply CRITICAL flags
    // ... existing enrichment + critical flag logic goes here ...
}
```

---

## Step 4 — Extend Company Enrichment for Polish Companies

Open `automation/company_enrichment.cjs` (if it exists) and add Polish lookup:

After the `lookupViaAriregister` function, add:

```js
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
```

And update the main `enrichCompanyData` function to include the Polish lookup:

```js
// Stage 2b: Polish KRS (for Sp. z o.o. / S.A. companies)
if (!result && (cc === 'PL' || vendorName.match(/Sp\.?\s*z\s*o\.?o\.?|S\.A\./i))) {
    result = await lookupViaKRS(vendorName);
}
```

---

## Step 5 — Verify Syntax and Test

```bash
cd /Users/einarluha/invoice-tracker
node --check automation/document_ai_service.cjs && echo "✅ docAI OK"
node --check automation/accountant_agent.cjs && echo "✅ accountant OK"
node --check automation/company_enrichment.cjs && echo "✅ enrichment OK"
```

Test Polish lookup:
```bash
node -e "
require('dotenv').config({ path: './automation/.env' });
const { enrichCompanyData } = require('./automation/company_enrichment.cjs');
enrichCompanyData('Terma Sp. z o.o.', 'PL').then(r => {
  console.log('Result:', JSON.stringify(r, null, 2));
  process.exit(0);
});
"
```

---

## Step 6 — Add Rule 30 to Chief Accountant Charter

Open `_agents/workflows/chief_accountant.md` and append:

```markdown
## 30. THE PRIVATE PERSON & POLISH COMPANY PROTOCOL
- **The Error**: The system applied identical "CRITICAL: VAT missing" flags to both incorporated companies (which must have VAT numbers by law) and private persons / sole traders (who are exempt from VAT registration below certain revenue thresholds). This caused all invoices from freelancers and private individuals to be permanently stuck in "Needs Action" status even when the data was correct.
- **Mandate**:
  1. **Private persons** (vendor name contains no company suffix: OÜ, AS, Ltd, GmbH, Sp. z o.o., UAB, SIA, etc.) must NOT be flagged critically for missing VAT/Reg. A warning note is sufficient.
  2. **Polish companies** (Sp. z o.o., S.A.) use "NIP" for VAT (format: PL + 10 digits) and "KRS" or "REGON" for registration. The Document AI prompt must explicitly list these Polish-specific labels.
  3. The Government Source Lookup (Rule 29) must include the Polish KRS API (`api-krs.ms.gov.pl`) in its chain for Polish companies.
  4. Country detection must recognize "Sp. z o.o." and "S.A." as Polish company markers (country code: PL) just as "OÜ"/"AS" marks Estonian companies.
```

---

## Step 7 — Commit

```bash
cd /Users/einarluha/invoice-tracker
git add automation/document_ai_service.cjs automation/accountant_agent.cjs automation/company_enrichment.cjs _agents/workflows/chief_accountant.md
git commit -m "fix: add Polish NIP/KRS extraction, private person VAT exemption logic, Rule 30"
```
