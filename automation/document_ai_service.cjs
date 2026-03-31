const { Anthropic } = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Balanced-brace JSON object extractor.
 * Handles nested objects and arrays correctly — unlike regex which stops at the first `}`.
 * Scans the raw string for any JSON object with a known `type` field.
 */
function salvageJsonObjects(str) {
    const results = [];
    const KNOWN_TYPES = new Set(['INVOICE', 'BANK_STATEMENT']);
    let i = 0;
    while (i < str.length) {
        if (str[i] !== '{') { i++; continue; }
        // Walk forward tracking depth, respecting strings and escape sequences
        let depth = 0, j = i, inStr = false, escape = false;
        while (j < str.length) {
            const ch = str[j];
            if (escape)          { escape = false; }
            else if (ch === '\\' && inStr) { escape = true; }
            else if (ch === '"') { inStr = !inStr; }
            else if (!inStr && ch === '{') { depth++; }
            else if (!inStr && ch === '}') {
                depth--;
                if (depth === 0) {
                    const candidate = str.slice(i, j + 1);
                    try {
                        const parsed = JSON.parse(candidate);
                        if (parsed && typeof parsed === 'object' && KNOWN_TYPES.has(parsed.type)) {
                            results.push(parsed);
                        }
                    } catch (_) { /* malformed fragment — skip */ }
                    break;
                }
            }
            j++;
        }
        i = j + 1;
    }
    return results;
}

/**
 * PURE CLAUDE EXTRACTION ENGINE 
 * Now supports Supervisor Reflection Loops (criticism parameter).
 */
async function processInvoiceWithDocAI(buffer, mimeType = 'application/pdf', supervisorCritique = null, customRules = null) {
    if (supervisorCritique) {
        console.log(`[Cognitive Extractor] 🧠 Receiving orders from Supervisor... Executing deep re-scan for missing data!`);
    } else {
        console.log(`[Cognitive Extractor] 🧠 Routing document natively through Claude 3.5 Sonnet...`);
    }
    
    try {
        const base64Data = buffer.toString('base64');
        const isPdf = mimeType.toLowerCase().includes('pdf');
        let normalizedMime = isPdf ? 'application/pdf' : (mimeType.toLowerCase().includes('png') ? 'image/png' : 'image/jpeg');
        const blockType = isPdf ? "document" : "image";

        let systemPrompt = `You are the Supreme AI Extraction Engine for a European Enterprise.
Your job is to read the attached financial document and extract the core data into a strict JSON format.

First, determine the TYPE of document:
TYPE A: INVOICE — any document requesting payment for goods or services. Includes: Arve, Faktura, Invoice, Bill, Rechnung, Sąskaita-faktūra, Lasku, Nota, Счёт — AND insurance premium bills (Kindlustusmakse arve, Vakuutusmaksu). The key test: does it say "Arve nr" or "Invoice" or "Faktura" and request a specific payment amount? If YES → TYPE A.
TYPE B: BANK STATEMENT (Выписка, Account Statement, Ledger, Transaction History)
TYPE C: JUNK — documents that are NOT payment requests: CMR, Delivery Note (Saateleht, Veoseleht), Advertisement, Ettemaksuteatis, Pro forma, Tellimuse kinnitus, blank pages, insurance POLICY documents (Kindlustuspoliis — the actual policy contract, NOT the premium payment bill).

CRITICAL DIRECTIVES:
1. INTELLIGENT CURRENCY: Extract the TRUE AMOUNT TO PAY in the international billing currency (EUR/USD). DO NOT extract the local tax conversion equivalent.
2. MANDATORY FIELDS (INVOICES): Vendor, Subtotal, Tax, Total, Supplier Reg No, and VAT Reg No. 
3. LANGUAGE & LOCALIZATION HINTS: Baltic invoices are critical. For ESTONIAN (OÜ/AS companies):
- supplierVat: look for "KMKR nr", "km.reg.nr", "kmkr", "käibemaksukohustuslase number", or "EE" prefix + 9 digits (e.g. EE101234567)
- supplierRegistration: look for "Reg.nr", "registrikood", "reg.kood", "Reg nr", or an 8-digit number in the footer
- These fields are ALWAYS in the tiny footer at the very bottom of the page — scan it carefully
- ESTONIAN AMOUNTS — read carefully: "Tasuda EUR" or "Tasuda kokku" = FINAL AMOUNT TO PAY (this is the 'amount' field, includes VAT). "Kokku" or "Kokku käibemaksuta" alone = subtotal WITHOUT VAT ('subtotalAmount'). "Käibemaks X%" = VAT amount ('taxAmount'). RULE: amount = subtotalAmount + taxAmount = "Tasuda" value.
- ESTONIAN INSURANCE BILLS (LHV Kindlustus, If Kindlustus, Seesam, Gjensidige): "Arve nr" = invoiceId, "KUUPÄEV" = dateCreated, "TASUMISE TÄHTPÄEV" = dueDate, "KINDLUSTUSMAKSE" = amount (insurance premium). VAT is 0 for insurance (exempt). supplierVat = Not_Found is acceptable. description = the insurance product type (e.g. "Kodukindlustus", "Sõidukikindlustus").
- For LATVIAN (SIA companies): "PVN" = VAT, "Reģ.nr" = Reg No
- For LITHUANIAN (UAB companies): "PVM" = VAT, "Įm.k." or "kodas" = Reg No; "Sąskaitą apmokėti" = due date; "Data" or "Išrašymo data" = issue date
- **Polish (Sp. z o.o. / S.A.)**: invoiceId = "Faktura numer" or "Numer faktury" value (e.g. "pl21-30"). dateCreated = "Data wystawienia". dueDate = "Termin płatności". amount = "Wartość brutto" or "Do zapłaty" (total WITH VAT). subtotalAmount = "Wartość netto". taxAmount = "Wartość VAT". supplierVat = "NIP" followed by 10 digits, may be formatted as PL+10 digits (e.g. PL1133099765). supplierRegistration = "KRS" (10 digits) or "REGON" (9 digits). "np" in VAT% column = nie podlega = VAT not applicable = taxAmount is 0.
- **Ukrainian (ТОВ / ФОП / private persons)**: If the vendor is a private person (first name + last name, no company suffix), they may use a personal tax ID called "ІПН" or "ЄДРПОУ" (8-10 digits). If no tax number exists on the document, output Not_Found — do NOT invent one.
- **General rule for private persons**: If the vendor name appears to be a human name (two words, no company suffix like OÜ/AS/Ltd/GmbH/Sp.z o.o.), set supplierRegistration and supplierVat to Not_Found unless explicitly printed on the document. Private persons are not required to have VAT numbers.
- For Czech/Slovak: "IČO" = Reg No, "DIČ" = VAT No
4. COMPLEX TAX BREAKDOWNS: If there are multiple tax rates or items (e.g., 20% and 0%), look for the master or total "Käibemaks" (Tax) and "Kokku" (Total) at the bottom summary. Do not mistake the row values for the total tax.
5. NO HALLUCINATIONS: If a text field (especially regNo or vatNumber) is completely absent from the physical document, you MUST output 'NOT_FOUND_ON_INVOICE'. Do not invent numbers.
6. DYNAMIC PRIORITY: I have provided a 'customRules' object detailing company-specific overrides. You must MATHEMATICALLY prioritize the customRules over any standard logic. If a customRule instructs a 30-day dueDate for a specific vendor, you MUST calculate and output that exact overridden date.
7. THE PRE-PAID RECEIPT RULE: If the physical document contains the text 'KAARDIMAKSE', 'MAKSTUD', 'TASUTUD', 'PAID', 'Maha võetud', 'Google Pay', or 'Apple Pay', you MUST explicitly set the 'status' field to 'Paid'. If these words do NOT appear, you MUST default the 'status' field strictly to 'OOTEL' (Pending).
8. THE RELATIONAL TEMPORAL RULE: If an invoice lacks a strict absolute Due Date (e.g. '14.03.2026') but instead provides a relational temporal clause like 'Maksetähtaeg: tasuda 14 päeva jooksul' (pay within 14 days), 'tasuda 7 päeva jooksul', or 'Neto 14 päeva', you MUST mathematically add that integer (e.g., 14) to the 'dateCreated' (Invoice Date) to calculate and output the exact YYYY-MM-DD absolute 'dueDate'. Do NOT return null if a relational day count is present.
9. THE ABSOLUTE DATE FALLBACK (RECEIPTS): If an invoice genuinely lacks ANY Due Date or relational temporal clause whatsoever (or if it is a pre-paid receipt like Google/Esvika), you MUST mathematically fallback by cloning the exact "dateCreated" string and outputting it as the "dueDate". NEVER output "NOT_FOUND_ON_INVOICE" or null for the dueDate field. Every invoice must have a YYYY-MM-DD.
10. THE COMPOUNDING DEBT TRAP (Võlgnevus): ONLY applies when the invoice explicitly contains the word "Võlgnevus" (arrears/overdue debt carried forward). In that case, the printed "Tasuda" (Total to Pay) includes old debt — you MUST isolate the current period charge: amount = subtotalAmount + taxAmount. For ALL OTHER invoices (no Võlgnevus), the 'amount' field MUST be the "Tasuda" / "Total" / "Do zapłaty" / "Bendra suma" value — i.e., the full amount to pay including VAT.
11. LOGISTICS & FREIGHT INVOICES — NUNNER RULE (CRITICAL, READ CAREFULLY):
Lithuanian logistics invoices (NUNNER Logistics UAB, DSV, Girteka, Linava) have a table with FOUR columns: "PVM sąskaita-faktūra / Invoice" | "Užsakymo nr. / Tracking no." | "Pozicijos nr. / Pos. no." | "Data / Date".
- The INVOICE ID is ONLY the value in the FIRST column ("PVM sąskaita-faktūra / Invoice"). It looks like "NN/NNNNNNNNNN" (e.g. "26/4211005335"). NEVER combine it with values from other columns.
- The TRACKING NUMBER in the SECOND column ("Užsakymo nr. / Tracking no.") e.g. "42260300810" is NEVER the invoice ID. Do NOT prepend or append it to the invoice ID.
- ⚠️ VENDOR NAME — THIS IS THE MOST COMMON MISTAKE: The VENDOR is the company printed in the TOP-LEFT LETTERHEAD of the document (e.g. "NUNNER Logistics UAB"). This is the company SENDING the invoice and requesting payment. The fields labeled "Siuntėjas / Shipper" or "Gavėjas / Consignee" (e.g. "PACKAGING SOLUTIONS NUR-SULTAN") describe the cargo route parties — they are NEVER the vendor. If you see "PACKAGING SOLUTIONS" anywhere on a NUNNER invoice, it is the cargo shipper, NOT the vendor.
- REAL EXAMPLE from NUNNER invoice: invoiceId="26/4211005335", vendorName="NUNNER Logistics UAB", supplierVat="LT100006153417", supplierRegistration="302632959", amount=4500.00, taxAmount=0, subtotalAmount=4500.00, description="Freight forwarding".

12. DESCRIPTION FIELD: Extract the top-level "description" as a SHORT human-readable summary of WHAT the invoice is for (e.g. "Transport services", "Office rent March", "Packaging materials", "Freight forwarding"). This MUST be derived from the service/goods description text on the invoice — NOT from the invoice number, NOT from the VAT/registration number, NOT from tracking numbers. If lineItems exist, use the first lineItem's description text. If no explicit description exists, infer from vendor context (e.g. logistics vendor → "Transport services"). NEVER output a string that consists only of digits, slashes, or looks like an ID (e.g. "4226030081026" or "1031/26/A" are WRONG — those are invoice/registration numbers, not descriptions).

IF TYPE A (INVOICE), respond ONLY with a JSON array matching this schema:
[
  {
    "type": "INVOICE",
    "invoiceId": "string",
    "vendorName": "string",
    "supplierRegistration": "string or Not_Found",
    "supplierVat": "string or Not_Found",
    "receiverName": "string",
    "receiverVat": "string",
    "amount": number,
    "taxAmount": number,
    "subtotalAmount": number,
    "currency": "EUR/USD/GBP",
    "dateCreated": "YYYY-MM-DD",
    "dueDate": "YYYY-MM-DD",
    "status": "OOTEL or Paid",
    "description": "short human-readable summary of what this invoice is for",
    "lineItems": [ { "description": "string", "amount": number } ]
  }
]

IF TYPE B (BANK STATEMENT), extract ALL OUTGOING PAYMENTS (money leaving the account). Respond ONLY with a JSON array where each object is a payment:
[
  {
    "type": "BANK_STATEMENT",
    "vendorName": "name of the payee/recipient",
    "paymentReference": "invoice number or description in the reference/details field",
    "amount": number,
    "dateCreated": "YYYY-MM-DD"
  }
]

IF TYPE C (JUNK), respond ONLY with an empty JSON array: []`;

        if (supervisorCritique) {
            systemPrompt += `\n\n🚨 SUPERVISOR CRITIQUE FROM PREVIOUS ATTEMPT:\n${supervisorCritique}\n\nThe Supervisor rejected your last JSON because you missed mandatory fields. You must scan the document again, pixel by pixel, specifically looking for the fields mentioned by the Supervisor. If you still cannot find them, you MUST write "Not_Found".`;
        }

        if (customRules && String(customRules).trim().length > 5) {
            systemPrompt += `\n\n🟢 CRITICAL COMPANY-SPECIFIC INSTRUCTIONS:\n${customRules}\n\nTHESE INSTRUCTIONS OVERRIDE EVERYTHING. YOU MUST EXECUTE THEM FLAWLESSLY. If instructed to calculate a dueDate + X days from creation, you MUST mathematically compute the exact chronological string date (YYYY-MM-DD)!`;
        }

        const response = await require('./ai_retry.cjs').createWithRetry(anthropic, {
            model: process.env.AI_MODEL_EXTRACTION || process.env.AI_MODEL || "claude-sonnet-4-6",
            max_tokens: 4000,
            temperature: 0.1,
            system: "You are the world's most intelligent accounting extraction AI.",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: systemPrompt },
                        {
                            type: blockType,
                            source: { type: "base64", media_type: normalizedMime, data: base64Data }
                        }
                    ]
                }
            ]
        });

        let rawJson = response.content[0].text.trim();
        const jsonMatch = rawJson.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonMatch) {
            rawJson = jsonMatch[0];
        } else if (rawJson.includes('[]')) {
            rawJson = '[]';
        } else {
            rawJson = rawJson.replace(/^```json\n|\n```$/g, '');
        }
        let extractedData = [];
        try {
            extractedData = JSON.parse(rawJson);
        } catch (e) {
            console.log(`[Cognitive Extractor] ⚠️ JSON parse failed (likely truncated response). Attempting balanced-brace salvage...`);
            extractedData = salvageJsonObjects(rawJson);
            if (extractedData.length > 0) {
                console.log(`[Cognitive Extractor] 🚑 SALVAGE SUCCESS! Recovered ${extractedData.length} item(s).`);
            } else {
                const preview = rawJson.slice(0, 500);
                console.error(`[Cognitive Extractor] 🚨 Salvage failed. Raw response was:\n${preview}`);
                throw new Error(`AI response unparseable — salvage recovered 0 items. Preview: ${preview}`);
            }
        }
        
        if (!Array.isArray(extractedData)) {
            extractedData = [extractedData];
        }
        
        // --- SANITIZE MISSING FIELDS EXPLICITLY ---
        extractedData.forEach(inv => {
            if (inv.type !== 'BANK_STATEMENT') {
                if (!inv.supplierRegistration || String(inv.supplierRegistration).trim() === '' || String(inv.supplierRegistration).toLowerCase() === 'null') {
                    inv.supplierRegistration = 'Not_Found';
                }
                if (!inv.supplierVat || String(inv.supplierVat).trim() === '' || String(inv.supplierVat).toLowerCase() === 'null') {
                    inv.supplierVat = 'Not_Found';
                }
            }
        });
        
        console.log(`[Cognitive Extractor] ✅ Extraction Complete:`);
        if (extractedData.length > 0) {
            console.log(`   -> Payload Type: ${extractedData[0].type || 'INVOICE'}`);
            console.log(`   -> First Item Vendor: ${extractedData[0].vendorName}`);
            console.log(`   -> Items Extracted: ${extractedData.length}`);
        }
        
        return extractedData;

    } catch (error) {
        console.error(`[Cognitive Extractor] 🚨 Local Exception:`, error.message);
        throw error;
    }
}

module.exports = { processInvoiceWithDocAI };
