require('dotenv').config();
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const { OpenAI } = require('openai');
const pdfParse = require('pdf-parse');
const { parse } = require('csv-parse/sync');
const { fromBuffer } = require('pdf2pic');

// Initialize OpenAI API
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Firebase Admin Initialization
const admin = require('firebase-admin');

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {
        console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT env var:", e);
    }
} else {
    try {
        serviceAccount = require('./google-credentials.json');
    } catch (e) {
        console.error("google-credentials.json not found locally.");
    }
}

if (!admin.apps.length && serviceAccount) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket: 'invoice-tracker-xyz.firebasestorage.app'
    });
}
const db = admin.firestore();
const bucket = admin.storage().bucket();

/**
 * Helper to upload an attachment directly to Firebase Storage and get a secure download URL.
 */
async function uploadToStorage(companyId, fileName, contentType, buffer) {
    const crypto = require('crypto');
    const cleanFileName = fileName ? fileName.replace(/[^a-zA-Z0-9.\-_]/g, '') : 'document.pdf';
    const uniqueName = Date.now() + '_' + cleanFileName;
    const filePath = `invoices/${companyId}/${uniqueName}`;
    const file = bucket.file(filePath);

    // Generate an unguessable token for public yet secure read access
    const uuid = crypto.randomUUID();

    await file.save(buffer, {
        metadata: {
            contentType: contentType,
            metadata: {
                firebaseStorageDownloadTokens: uuid
            }
        }
    });

    const encodedPath = encodeURIComponent(filePath);
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${uuid}`;
}


/**
 * 1. AI Parsing: Sends raw text (or CSV string) to OpenAI to extract fields
 */
async function parseInvoiceDataWithAI(rawText, companyName = "GLOBAL TECHNICS OÜ", customRules = "") {
    console.log(`[AI] Parsing raw data with OpenAI for company: ${companyName}...`);

    let customRulesSection = "";
    if (customRules && customRules.trim().length > 0) {
        customRulesSection = `
CRITICAL USER-DEFINED AI RULES (MUST OBEY):
${customRules}
`;
    }

    // System prompt defines the strict output we expect
    const prompt = `
You are an expert accountant system. 
Extract ALL invoices from the provided raw text (often a messy CSV, PDF report, or email body).
Return EXACTLY a JSON array of invoice objects with NO markdown wrapping, NO extra text.
Even if there is only one invoice, return it as an ARRAY containing that single object.

CRITICAL RULE FOR VENDOR NAME:
The company "${companyName}" (and any variations) AND "GLOBAL TECHNICS OÜ" are ALWAYS the BUYER/CUSTOMER. 
They are NEVER the vendor/seller. 
You must find the ACTUAL company that issued the invoice to ${companyName} (e.g., look for "Müüja", "Saatja", "Tarnija", or the company logo text). 
If an invoice is issued by "FS Teenused OÜ" to "${companyName}", the vendorName MUST be "FS Teenused OÜ".

CRITICAL RULE FOR REJECTING NON-INVOICE DOCUMENTS:
You must ONLY extract actual Invoices (Arve, Invoice, Счет), Credit Notes (Kreeditarve), or Receipts (Kviitung).
DO NOT extract Insurance Policies (Poliis, Kindlustuspoliis), Contracts (Leping), Certificates, or general letters.
If the document is a Policy or does not have a clear "amount to pay" for a service/good, return an empty array [].

CRITICAL RULE FOR AMOUNT (DEBT AVOIDANCE / ESTONIAN TERMS):
If the invoice contains a balance for previous unpaid months (e.g., "Võlgnevus", "Eelnevate perioodide võlg", "Previous balance", "Maksmisele kuuluv summa" which includes past debt), DO NOT include this debt in the final 'amount'.
You MUST only extract the pure amount for the CURRENT billing period.
Estonian Translation Guide: "Tasuda", "Tasuda EUR", "Kulumishüvitis", or "Kokku" typically indicate the final Amount to pay.
For example: If "Perioodi arve" is 88.30 and "Võlgnevus" is 94.23 making "KOKKU" 182.53, the 'amount' MUST be exactly 88.30.

CRITICAL RULE FOR DATES (LANGUAGES & FORMATS):
Convert ALL alphabetical month names into their exact 2-digit numerical equivalent.
Examples: "Jan" or "January" -> 01, "Feb" -> 02, "Mar" -> 03, "Apr" -> 04, "May" -> 05, etc.
Estonian Translation Guide: "Tähtaeg", "Maksetähtaeg", or "Maksetähtpäev" ALWAYS unequivocally mean DUE DATE.
If the Date is "Mar 6, 2026", dateCreated MUST be "06-03-2026".
If the Due Date is "Mar 8, 2026", dueDate MUST be "08-03-2026".
Do NOT hallucinate or add months or hardcode 30 days unless explicitly told to.

${customRulesSection}
Required fields for EACH invoice object (if missing, guess intelligently or leave empty string):
- invoiceId: (e.g. Inv-006, Dok. nr., Ostuarve nr. CRITICAL: NEVER use a date like "16.01.2026". NEVER use generic titles like "Invoice", "PVM", "sąskaita", or "faktūra" as the ID. It must be the specific numeric/alphanumeric invoice number.)
- vendorName: (The EXACT company issuing the invoice, NEVER ${companyName} and NEVER GLOBAL TECHNICS OÜ)
- amount: (Number only, decimal separated by dot. Final total amount for the current period, EXCLUDING past debt. CRITICAL: If it is a credit invoice / Kreeditarve / Credit Note, the amount MUST be a negative number, e.g. -50.00)
- currency: (3 letter code, usually EUR)
- dateCreated: (DD-MM-YYYY format. CRITICAL: Parse strictly from 'Arve kuupäev' or 'Kuupäev'. Do NOT use random dates like service periods or 'Arveldusperiood'.)
- dueDate: (DD-MM-YYYY format, parse from Maksetähtaeg)
- description: (String, max 3-4 words. E.g., "Telecom services", "Fuel", "Transport". Guess based on vendor if not explicit.)

Raw Data:
${rawText}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini", // Cost-effective and fast model
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
        });

        const jsonString = response.choices[0].message.content.trim();
        // Remove markdown formatting if OpenAI accidentally adds it
        const cleanJson = jsonString.replace(/^```json/g, '').replace(/^```/g, '').replace(/```$/g, '').trim();

        const parsedArray = JSON.parse(cleanJson);

        // Safety check: if AI missed the negative sign for a credit invoice, force it
        const lowerText = rawText.toLowerCase();
        const isCreditInvoice = lowerText.includes('kreeditarve') || lowerText.includes('krediitarve') || lowerText.includes('credit note') || lowerText.includes('credit invoice') || lowerText.includes('kreedit');

        if (Array.isArray(parsedArray)) {
            parsedArray.forEach(invoice => {
                let currentAmt = 0;
                if (typeof invoice.amount === 'string') {
                    currentAmt = parseFloat(invoice.amount.replace(/[^0-9.-]+/g, '')) || 0;
                } else if (typeof invoice.amount === 'number') {
                    currentAmt = invoice.amount;
                }

                if (isCreditInvoice && currentAmt > 0) {
                    invoice.amount = -currentAmt; // Force it negative
                }
            });
        }

        return parsedArray;
    } catch (error) {
        console.error('[AI Error] Failed to parse data:', error);
        return null; // Return null if parsing fails
    }
}

/**
 * 1.5. AI Parsing (Vision): Sends image (Base64) to OpenAI gpt-4o for OCR and extraction
 */
async function parseInvoiceImageWithAI(base64Image, companyName = "GLOBAL TECHNICS OÜ", customRules = "", mimeType = "image/jpeg") {
    console.log(`[AI Vision] Parsing image data with OpenAI for company: ${companyName}...`);

    let customRulesSection = "";
    if (customRules && customRules.trim().length > 0) {
        customRulesSection = `
CRITICAL USER-DEFINED AI RULES (MUST OBEY):
${customRules}
`;
    }

    const promptText = `
You are an expert accountant system. 
Extract ALL invoices from the provided image (receipt, scanned document).
Return EXACTLY a JSON array of invoice objects with NO markdown wrapping, NO extra text.
Even if there is only one invoice, return it as an ARRAY containing that single object.

CRITICAL RULE FOR VENDOR NAME:
The company "${companyName}" (and any variations) AND "GLOBAL TECHNICS OÜ" are ALWAYS the BUYER/CUSTOMER. 
You must find the ACTUAL company that issued the invoice to ${companyName}.

CRITICAL RULE FOR REJECTING NON-INVOICE DOCUMENTS:
You must ONLY extract actual Invoices (Arve, Invoice, Счет), Credit Notes (Kreeditarve), or Receipts (Kviitung).
DO NOT extract Insurance Policies (Poliis, Kindlustuspoliis), Contracts (Leping), Certificates, or general letters.
If the document is a Policy or does not have a clear "amount to pay" for a service/good, return an empty array [].

CRITICAL RULE FOR AMOUNT:
DO NOT include past debt. Extract only the amount for the CURRENT billing period.
If it is a credit note, amount MUST be negative.
Estonian Translation Guide: "Tasuda", "Tasuda EUR", "Kulumishüvitis", or "Kokku" typically indicate the final Amount to pay.

CRITICAL RULE FOR DATES:
Convert ALL alphabetical month names into their exact 2-digit numerical equivalent.
Examples: "Jan" or "January" -> 01, "Feb" -> 02, "Mar" -> 03, "Apr" -> 04, "May" -> 05, etc.
Estonian Translation Guide: "Tähtaeg", "Maksetähtaeg", or "Maksetähtpäev" ALWAYS unequivocally mean DUE DATE.
If the Date is "Mar 6, 2026", dateCreated MUST be "06-03-2026".
If the Due Date is "Mar 8, 2026", dueDate MUST be "08-03-2026".
Do NOT hallucinate or add months or hardcode 30 days unless explicitly told to.

${customRulesSection}
Required fields:
- invoiceId: (specific numeric/alphanumeric invoice number)
- vendorName: (The EXACT company issuing the invoice)
- amount: (Number only, decimal separated by dot)
- currency: (3 letter code, usually EUR)
- dateCreated: (DD-MM-YYYY format, issue date)
- dueDate: (DD-MM-YYYY format)
- description: (String, max 3-4 words)
`;

    // Ensure we don't double-prefix if base64Image somehow already contains 'data:image'
    const cleanBase64 = base64Image.startsWith('data:') ? base64Image.split(',')[1] : base64Image;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: promptText },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:${mimeType};base64,${cleanBase64}`
                            }
                        }
                    ]
                }
            ],
            temperature: 0.1,
        });

        const jsonString = response.choices[0].message.content.trim();
        const cleanJson = jsonString.replace(/^```json/g, '').replace(/^```/g, '').replace(/```$/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (error) {
        console.error('[AI Vision Error] Failed to parse image data:', error);
        return null;
    }
}


/**
 * 2. Writes the parsed JSON data array to Firebase Firestore
 */
async function writeToFirestore(dataArray) {
    if (!dataArray || !Array.isArray(dataArray) || dataArray.length === 0) return;

    try {
        console.log(`[Firestore] Adding ${dataArray.length} invoice(s) to database...`);
        const batch = db.batch();
        const invoicesRef = db.collection('invoices');

        for (const data of dataArray) {
            const docRef = invoicesRef.doc(); // Auto-generate ID

            // Format amount as number
            let numAmount = 0;
            if (typeof data.amount === 'string') {
                numAmount = parseFloat(data.amount.replace(/[^0-9.-]+/g, '')) || 0;
            } else if (typeof data.amount === 'number') {
                numAmount = data.amount;
            }

            // Formulate data
            const vendorName = data.vendorName || 'Unknown Vendor';
            const invoiceId = data.invoiceId || `Auto-${Date.now()}`;

            // --- VENDOR SPECIFIC RULE EXECUTOR ---
            const lowerVendor = vendorName.toLowerCase();
            if (lowerVendor.includes('pronto') || lowerVendor.includes('inovatus')) {
                if (data.dateCreated) {
                    const parts = data.dateCreated.includes('-') ? data.dateCreated.split('-') : data.dateCreated.split('.');
                    if (parts.length === 3) {
                        let day, month, year;
                        if (parts[0].length === 4) { // YYYY-MM-DD
                            year = parseInt(parts[0], 10);
                            month = parseInt(parts[1], 10) - 1;
                            day = parseInt(parts[2], 10);
                        } else { // DD-MM-YYYY
                            day = parseInt(parts[0], 10);
                            month = parseInt(parts[1], 10) - 1;
                            year = parseInt(parts[2], 10);
                        }
                        if (year < 2000) year += 2000;
                        const d = new Date(year, month, day);
                        d.setDate(d.getDate() + 30);
                        const newDay = String(d.getDate()).padStart(2, '0');
                        const newMonth = String(d.getMonth() + 1).padStart(2, '0');
                        const newYear = d.getFullYear();
                        data.dueDate = `${newDay}-${newMonth}-${newYear}`;
                        console.log(`[AI Override] Hardcoded +30 days for ${vendorName}. New dueDate: ${data.dueDate}`);
                    }
                }
            }

            // --- DUPLICATE PREVENTION LOGIC ---
            let isDuplicate = false;
            let existingDocId = null;

            // 1. Check by Invoice ID + Vendor Name + Company
            if (data.invoiceId) {
                const idQuery = await invoicesRef.where('invoiceId', '==', invoiceId).get();
                for (const doc of idQuery.docs) {
                    const existingData = doc.data();
                    const existingVendor = (existingData.vendorName || '').toString().toLowerCase().trim();
                    const newVendor = (vendorName || '').toString().toLowerCase().trim();

                    if (existingVendor === newVendor && existingData.companyId === data.companyId) {
                        isDuplicate = true;
                        existingDocId = doc.id;
                        break;
                    }
                }
            }

            // 2. Check by Date + Amount + Vendor Name + Company (Catches ID variations like "Arvenr6199" vs "6199")
            if (!isDuplicate && data.dateCreated && numAmount !== 0) {
                const dateQuery = await invoicesRef
                    .where('dateCreated', '==', data.dateCreated)
                    .where('amount', '==', numAmount)
                    .get();

                for (const doc of dateQuery.docs) {
                    const existingData = doc.data();
                    const existingVendor = (existingData.vendorName || '').toString().toLowerCase().trim();
                    const newVendor = (vendorName || '').toString().toLowerCase().trim();

                    if (existingVendor === newVendor && existingData.companyId === data.companyId) {
                        console.log(`[Firestore] Duplicate caught by Date/Amount/Vendor match. Existing ID: ${existingData.invoiceId}, New ID: ${invoiceId}`);
                        isDuplicate = true;
                        existingDocId = doc.id;
                        break;
                    }
                }
            }

            if (isDuplicate) {
                if (data.fileUrl && existingDocId) {
                    console.log(`[Firestore] Updating duplicate invoice with new fileUrl: ${vendorName} - ${invoiceId}`);
                    batch.update(invoicesRef.doc(existingDocId), {
                        fileUrl: data.fileUrl
                    });
                } else {
                    console.log(`[Firestore] Skipping duplicate invoice: ${vendorName} - ${invoiceId}`);
                }
                continue;
            }

            let status = 'Unpaid'; // Default status

            // --- CREDIT INVOICE OFFSET LOGIC ---
            if (numAmount < 0) {
                status = 'Paid'; // Credit invoices don't need payment
                const targetAmount = Math.abs(numAmount);

                // Find a pending positive invoice from the same vendor and amount
                const pendingSnapshot = await invoicesRef.where('status', '!=', 'Paid').get();

                for (const potentialOffset of pendingSnapshot.docs) {
                    const passData = potentialOffset.data();
                    if (Math.abs((passData.amount || 0) - targetAmount) <= 0.05) {
                        const v1 = String(vendorName).toLowerCase().replace(/[^a-z0-9]/g, '');
                        const v2 = String(passData.vendorName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (v1 && v2 && (v1.includes(v2) || v2.includes(v1))) {
                            console.log(`[Credit-Offset] Matched credit invoice to original invoice ${passData.invoiceId} (Amount: ${passData.amount}). Marking original as Paid.`);
                            batch.update(potentialOffset.ref, { status: 'Paid' });
                            break; // Offset only one invoice
                        }
                    }
                }
            }

            batch.set(docRef, {
                invoiceId: invoiceId,
                vendorName: vendorName,
                amount: numAmount,
                currency: data.currency || 'EUR',
                dateCreated: data.dateCreated || '',
                dueDate: data.dueDate || '',
                status: status,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                companyId: data.companyId || 'bP6dc0PMdFtnmS5QTX4N'
            });
        }

        await batch.commit();
        console.log(`[Firestore] ${dataArray.length} invoice(s) successfully written!`);
    } catch (error) {
        console.error('[Firestore Error] Database upload failed:', error.message);
    }
}

/**
 * 3. Bank Reconciliation Logic
 */
async function reconcilePayment(reference, description, paidAmount, paymentDateStr = null) {
    try {
        const invoicesRef = db.collection('invoices');
        let matchedDoc = null;
        let isCrossCurrencyMatch = false;

        const normalizeString = (str) => String(str || '').toLowerCase().trim();
        const normalizeAlphaNum = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        // Fetch all invoices to intelligently split Unpaid vs Already Paid
        const snapshot = await invoicesRef.get();
        const pendingDocs = [];
        const paidDocs = [];
        snapshot.forEach(doc => {
            if (doc.data().status === 'Paid') paidDocs.push(doc);
            else pendingDocs.push(doc);
        });

        // Sort by dateCreated (oldest first) to prioritize older debt if amounts/names duplicate
        const parseDateFallback = (d) => {
            if (!d) return 0;
            const match = d.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
            if (match) {
                let [_, day, month, yr] = match;
                if (yr.length === 2) yr = '20' + yr;
                return new Date(`${yr}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`).getTime();
            }
            return new Date(d).getTime() || 0;
        };
        pendingDocs.sort((a, b) => parseDateFallback(a.data().dateCreated) - parseDateFallback(b.data().dateCreated));

        const bankRefClean = normalizeAlphaNum(reference);
        let bankDesc = normalizeString(description);

        // --- VENDOR ALIASES ---
        // Map commercial names from bank statements to official company names in the database
        const vendorAliases = {
            'elron': 'eesti liinirongid as',
            'www.elron.ee': 'eesti liinirongid as'
        };
        for (const [alias, officialStr] of Object.entries(vendorAliases)) {
            if (bankDesc.includes(alias)) {
                console.log(`[Reconciliation] Applying Vendor Alias: ${alias} -> ${officialStr}`);
                bankDesc = officialStr;
                break;
            }
        }
        const extractDigits = (str) => String(str || '').replace(/[^0-9]/g, '');
        const refDigits = extractDigits(reference);

        // 0. Prevent Duplicate Processing of Historical Payments
        // If this payment perfectly matches the Reference of an ALREADY PAID invoice, 
        // we assume this is an old historical payment being re-ingested and skip it entirely.
        if (bankRefClean) {
            let isHistoricDuplicate = false;
            for (const doc of paidDocs) {
                const data = doc.data();
                const dbId = normalizeAlphaNum(data.invoiceId);
                const dbDigits = extractDigits(data.invoiceId);

                if (dbId) {
                    const isHardMatch = dbId === bankRefClean ||
                        (dbId.length >= 4 && bankRefClean.includes(dbId)) ||
                        (bankRefClean.length >= 4 && dbId.includes(bankRefClean));

                    const isDigitMatch = dbDigits.length >= 4 && refDigits.length >= 4 &&
                        (refDigits.includes(dbDigits) || dbDigits.includes(refDigits)) &&
                        Math.abs((data.amount || 0) - paidAmount) <= 0.05;

                    if (isHardMatch || isDigitMatch) {
                        isHistoricDuplicate = true;
                        console.log(`[Reconciliation] Skipping payment €${paidAmount} (${description}): Reference matches ALREADY PAID historic invoice ${data.invoiceId}`);
                        break;
                    }
                }
            }
            if (isHistoricDuplicate) return; // Discard this payment
        }

        // 1. Match by Reference (Substring matching allowed)
        if (bankRefClean) {
            for (const doc of pendingDocs) {
                const data = doc.data();
                const dbId = normalizeAlphaNum(data.invoiceId);
                const dbDigits = extractDigits(data.invoiceId);

                if (dbId) {
                    // Exact match or mutual substring match (e.g. "invoice no 3" vs "3")
                    // Plus advanced digit extraction logic for inverted strings like "ETTEMAKSUTEATIS 3079215" vs "3079215ETTEMAKSUTEATIS" (only accepted if Amount also strictly matches)
                    const isHardMatch = dbId === bankRefClean ||
                        (dbId.length >= 4 && bankRefClean.includes(dbId)) ||
                        (bankRefClean.length >= 4 && dbId.includes(bankRefClean));

                    const isDigitMatch = dbDigits.length >= 4 && refDigits.length >= 4 &&
                        (refDigits.includes(dbDigits) || dbDigits.includes(refDigits)) &&
                        Math.abs((data.amount || 0) - paidAmount) <= 0.05;

                    if (isHardMatch || isDigitMatch) {
                        matchedDoc = doc;
                        console.log(`[Reconciliation] Match found by Reference: ${data.invoiceId}`);
                        break;
                    }
                }
            }
        }

        // 2. Fallback: Match by Vendor Name + Exact Amount is DISABLED.
        // During historical testing, old payments were re-applied to new invoices simply because
        // they shared the same Vendor Name and Amount. The system now requires a Reference Match or
        // an exclusive Unique Amount match to prevent accidental cross-reconciliations.

        // 3. Fallback: Match by Vendor Name + Exact Amount
        // Since pendingDocs is already sorted by date (oldest first), this correctly handles identical recurring invoices 
        // across different vendors (e.g. paying 4500 EUR to NUNNER does not get blocked by IP Telecom also billing 4500).
        if (!matchedDoc && paidAmount > 0) {
            const matches = pendingDocs.filter(doc => {
                const data = doc.data();
                if (Math.abs((data.amount || 0) - paidAmount) > 0.05) return false;
                const vendorWords = (data.vendorName || '').toLowerCase().split(/[^a-z0-9]/).filter(w => w.length >= 3);
                return vendorWords.some(word => bankDesc.includes(word));
            });

            if (matches.length > 0) {
                matchedDoc = matches[0];
                console.log(`[Reconciliation] Match found by Vendor + Exact Amount: €${paidAmount} -> ${matchedDoc.data().vendorName} (Invoice: ${matchedDoc.data().invoiceId})`);
            }
        }

        // 4. Cross-Currency Fallback: Exact Vendor + Exact Date (Amount Differs safely)
        if (!matchedDoc && paymentDateStr && description) {
            const pDate = new Date(paymentDateStr).toISOString().split('T')[0];

            for (const doc of pendingDocs) {
                const data = doc.data();
                const vendorWords = (data.vendorName || '').toLowerCase().split(/[^a-z0-9]/).filter(w => w.length >= 3);
                const isNameMatch = vendorWords.some(word => bankDesc.includes(word));

                if (isNameMatch && data.dateCreated) {
                    // Try parsing database dateCreated
                    const match = data.dateCreated.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
                    let dbDateIso = '';
                    if (match) {
                        let [_, day, month, yr] = match;
                        if (yr.length === 2) yr = '20' + yr;
                        dbDateIso = new Date(`${yr}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`).toISOString().split('T')[0];
                    } else {
                        // fallback native parse
                        const nd = new Date(data.dateCreated);
                        if (!isNaN(nd)) dbDateIso = nd.toISOString().split('T')[0];
                    }

                    if (dbDateIso === pDate) {
                        matchedDoc = doc;
                        isCrossCurrencyMatch = true;
                        console.log(`[Reconciliation] Match found by Cross-Currency (Vendor+Date): ${data.vendorName} on ${pDate}. Adjusting amount from ${data.amount} ${data.currency} to ${paidAmount} EUR.`);
                        // For cross-currency, we overwrite the invoice amount to exactly what was actually paid in EUR from the bank statement so it balances.
                        await doc.ref.update({ amount: paidAmount, currency: 'EUR' });
                        data.amount = paidAmount; // Update local memory
                        break;
                    }
                }
            }
        }

        if (matchedDoc) {
            const data = matchedDoc.data();
            const docRef = matchedDoc.ref;

            console.log(`[Reconciliation] Matched payment €${paidAmount} to Invoice ${data.invoiceId} (Total: €${data.amount})`);

            // If it's a cross-currency match, it's intrinsically fully Paid (bypass partial deduction check)
            if (isCrossCurrencyMatch || paidAmount >= (data.amount - 0.05)) {
                await docRef.update({ status: 'Paid' });
                console.log(`  -> Marked as Paid!`);

                // --- PRO FORMA / PREPAYMENT CASCADE DUPLICATE RESOLUTION --- //
                // If this is a prepayment/pro forma that got paid, or if the real one got paid, mark the pair.
                const isPrepayment = (id) => String(id).toLowerCase().match(/(ettemaks|pro\s?forma|prepayment)/);

                const matchedVendor = normalizeString(data.vendorName);
                const matchedAmount = data.amount;
                const matchedId = data.invoiceId;

                // Only scan for duplicates if the exact full amount was paid
                for (const doc of pendingDocs) {
                    if (doc.id === matchedDoc.id) continue; // Skip self

                    const pData = doc.data();
                    const pVendor = normalizeString(pData.vendorName);

                    // Does the Vendor perfectly overlap and Amount exactly equal?
                    if (Math.abs(pData.amount - matchedAmount) <= 0.05) {
                        const pWords = pVendor.split(/[^a-z0-9]/).filter(w => w.length >= 3);
                        const mWords = matchedVendor.split(/[^a-z0-9]/).filter(w => w.length >= 3);
                        const isVendorTwin = pWords.some(w => matchedVendor.includes(w)) || mWords.some(w => pVendor.includes(w));

                        if (isVendorTwin) {
                            // Only trigger Cascade Paid if one of them is clearly a prepayment / ettemaks
                            if (isPrepayment(matchedId) || isPrepayment(pData.invoiceId)) {
                                console.log(`[Reconciliation-ProFormaSwap] Found corresponding mirror invoice (ProForma/Real pair): ${pData.invoiceId}. Marking as Paid automatically.`);
                                await doc.ref.update({ status: 'Paid' });
                                // Keep scanning in case there are multiple
                            }
                        }
                    }
                }

            } else {
                const newAmount = data.amount - paidAmount;
                // If it was unpaid, mark as pending to show partial payment
                const newStatus = (data.status === 'Unpaid' || !data.status) ? 'Pending' : data.status;
                await docRef.update({ amount: parseFloat(newAmount.toFixed(2)), status: newStatus });
                console.log(`  -> Partial payment. Remaining: €${newAmount.toFixed(2)}. Status: ${newStatus}`);
            }
        } else {
            console.log(`[Reconciliation] No pending invoice match for payment €${paidAmount} (Ref: ${reference}, Desc: ${description})`);
        }

    } catch (err) {
        console.error('[Reconciliation Error]', err);
    }
}

async function processBankStatement(csvText) {
    console.log('[Bank Reconciliation] Processing bank statement CSV...');
    try {
        const records = parse(csvText, {
            columns: true,
            skip_empty_lines: true,
            relax_column_count: true
        });

        for (const row of records) {
            const state = row['State'] || '';
            let amountStr = row['Amount'] || row['Total amount'] || '';

            if (state !== 'COMPLETED') continue;

            let amount = parseFloat(amountStr.replace(/,/g, ''));
            if (isNaN(amount) || amount >= 0) continue; // Only process outgoing (negative)

            const paidAmount = Math.abs(amount);
            const reference = (row['Reference'] || '').trim();
            const dateStr = (row['Date started (UTC)'] || row['Completed Date'] || row['Date'] || '').trim();
            // Remove bank prefixes like "Получатель: " or "Оплата: " to get the raw vendor name
            let description = (row['Description'] || row['Payer'] || '').trim();
            description = description.replace(/^(получатель|оплата|зачисление|перевод):\s*/i, '');

            await reconcilePayment(reference, description, paidAmount, dateStr);
        }
        console.log('[Bank Reconciliation] Bank statement processing completed.');
    } catch (error) {
        console.error('[Bank Error] Failed to process CSV:', error);
    }
}

/**
 * 3.5 AI Parsing for Bank Statements (PDFs)
 */
async function parseBankStatementWithAI(rawText) {
    console.log('[AI] Parsing PDF Bank Statement with OpenAI...');

    const prompt = `
You are an expert accountant system parsing a bank account statement (e.g. from Revolut Business).
Extract ALL outgoing payment transactions (Expenses / Расходы).
Return EXACTLY a JSON array of transaction objects with NO markdown wrapping, NO extra text.

Required fields for EACH transaction object:
- date: (String. The date of the transaction in YYYY-MM-DD format. E.g. 2026-03-02)
- description: (String. The name of the recipient/payee, e.g. "Google One", "Bolt", "Alexela AS", or payment description)
- reference: (String. Any invoice number or reference code mentioned in the payment details. Leave empty string if none)
- amount: (Number only, decimal separated by dot. MUST be a positive absolute number representing the expense amount, e.g. 10.00)

Ignore any incoming money (Прибыль), starting balances, and bank fees if they are labeled simply as 'Комиссия'. Focus on payments to vendors.

Raw Data:
${rawText}
`;

    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
        });

        const jsonString = response.choices[0].message.content.trim();
        const cleanJson = jsonString.replace(/^```json/g, '').replace(/^```/g, '').replace(/```$/g, '').trim();

        return JSON.parse(cleanJson);
    } catch (error) {
        console.error('[AI Error] Failed to parse bank statement data:', error);
        return null;
    }
}

/**
 * 4. Main IMAP function: Connects to email, finds UNSEEN messages with attachments
 */
async function checkEmailForInvoices(imapConfig, companyName = "Default", companyId = "bP6dc0PMdFtnmS5QTX4N", customRules = "") {
    const config = {
        imap: {
            user: imapConfig.user,
            password: imapConfig.password,
            host: imapConfig.host,
            port: imapConfig.port,
            tls: process.env.IMAP_TLS === 'true',
            authTimeout: 30000, // Increased timeout 
            connTimeout: 30000, // Added connection timeout
            tlsOptions: { rejectUnauthorized: false } // Helps bypass strict SSL cert issues
        }
    };

    try {
        console.log(`[Email] Connecting to IMAP server ${config.imap.host} for ${companyName} (${config.imap.user})...`);
        const connection = await imaps.connect(config);

        console.log('[Email] Connection successful! Opening INBOX.');
        await connection.openBox('INBOX');

        const searchCriteria = ['UNSEEN']; // Only get unread emails
        const fetchOptions = { bodies: [''], markSeen: true }; // Mark as read after fetching

        const messages = await connection.search(searchCriteria, fetchOptions);
        console.log(`[Email] Found ${messages.length} unread new emails.`);

        for (const item of messages) {
            const all = item.parts.find(a => a.which === '');
            const id = item.attributes.uid;
            const parsedEmail = await simpleParser(all.body);

            console.log(`[Email] Processing email subject: "${parsedEmail.subject}"`);

            // Find attachments
            if (parsedEmail.attachments && parsedEmail.attachments.length > 0) {
                for (const attachment of parsedEmail.attachments) {
                    const filename = (attachment.filename || '').toLowerCase();
                    const mime = (attachment.contentType || '').toLowerCase();

                    if (!filename && !mime) continue; // Skip entirely broken inline attachments

                    if (
                        mime.includes('csv') || mime.includes('excel') ||
                        filename.endsWith('.csv') || filename.endsWith('.xlsx') || filename.endsWith('.xls') ||
                        mime.includes('pdf') || filename.endsWith('.pdf') ||
                        mime.includes('image/jpeg') || mime.includes('image/png') ||
                        filename.endsWith('.jpg') || filename.endsWith('.jpeg') || filename.endsWith('.png')
                    ) {
                        console.log(`[Email] Found relevant attachment: ${attachment.filename || 'unknown'}. Reading text...`);

                        let rawContent = '';

                        // --- UPLOAD ORIGINAL ATTACHMENT TO STORAGE ---
                        let fileUrl = null;
                        try {
                            console.log(`[Storage] Uploading ${filename} to Firebase Storage...`);
                            fileUrl = await uploadToStorage(companyId, filename, mime, attachment.content);
                            console.log(`[Storage] Successfully uploaded! URL: ${fileUrl}`);
                        } catch (uploadError) {
                            console.error(`[Storage Error] Failed to upload ${filename}:`, uploadError);
                        }

                        // Helper to inject the generated URL and save
                        const saveParsedData = async (data) => {
                            if (data && Array.isArray(data) && data.length > 0) {
                                data.forEach(inv => {
                                    inv.companyId = companyId;
                                    if (fileUrl) inv.fileUrl = fileUrl;
                                });
                                await writeToFirestore(data);
                                return true;
                            }
                            return false;
                        };

                        try {
                            if (mime.includes('pdf') || filename.endsWith('.pdf')) {
                                console.log('[PDF] Parsing PDF data...');
                                const pdfData = await pdfParse(attachment.content);
                                rawContent = pdfData.text;

                                if (rawContent.trim().length < 10) {
                                    console.log(`[PDF] Extracted text is empty (likely a scanned image). Attempting pure JS extraction with pdf-lib...`);
                                    try {
                                        const { PDFDocument, PDFName, PDFStream } = require('pdf-lib');
                                        const doc = await PDFDocument.load(attachment.content, { ignoreEncryption: true });
                                        const context = doc.context;

                                        let foundJpeg = null;
                                        for (const [ref, obj] of context.enumerateIndirectObjects()) {
                                            if (obj instanceof PDFStream) {
                                                const dict = obj.dict;
                                                const subtype = dict.get(PDFName.of('Subtype'));
                                                if (subtype === PDFName.of('Image')) {
                                                    const filter = dict.get(PDFName.of('Filter'));
                                                    let filterName = filter ? filter.toString() : '';
                                                    if (filterName.includes('DCTDecode')) {
                                                        foundJpeg = obj.contents;
                                                        break;
                                                    }
                                                }
                                            }
                                        }

                                        if (foundJpeg) {
                                            console.log(`[PDF] Successfully extracted raw JPEG image from PDF stream! (${foundJpeg.length} bytes)`);
                                            const base64Data = Buffer.from(foundJpeg).toString('base64');
                                            const parsedData = await parseInvoiceImageWithAI(base64Data, companyName, customRules, "image/jpeg");

                                            if (await saveParsedData(parsedData)) {
                                                console.log(`[Email] Email UID ${id} successfully processed from Scanned PDF Image!`);
                                            }
                                        } else {
                                            console.log(`[PDF] No embedded JPEG found in scanned document. Cannot process.`);
                                            // Fallback to body text ONLY if there is actual text
                                            const fallbackBody = (parsedEmail.text || parsedEmail.html || '').trim();
                                            if (fallbackBody.length > 250) {
                                                rawContent = `[Attachment Name: ${attachment.filename || 'unknown'}]\n\n${fallbackBody}`;
                                                const parsedData = await parseInvoiceDataWithAI(rawContent, companyName, customRules);
                                                if (await saveParsedData(parsedData)) {
                                                    console.log(`[Email] Email UID ${id} successfully processed from body text fallback!`);
                                                }
                                            }
                                        }

                                    } catch (conversionError) {
                                        console.error(`[PDF Extraction Error] Failed to extract from scanned PDF:`, conversionError.message || conversionError);
                                        // Fallback to body text ONLY if there is actual text
                                        const fallbackBody = (parsedEmail.text || parsedEmail.html || '').trim();
                                        if (fallbackBody.length > 250) {
                                            rawContent = `[Attachment Name: ${attachment.filename || 'unknown'}]\n\n${fallbackBody}`;
                                            const parsedData = await parseInvoiceDataWithAI(rawContent, companyName, customRules);
                                            if (await saveParsedData(parsedData)) {
                                                console.log(`[Email] Email UID ${id} successfully processed from body text fallback!`);
                                            }
                                        }
                                    }
                                } else {
                                    // --- Detect Bank Statement vs Invoice ---
                                    const lowerText = rawContent.toLowerCase();
                                    if (lowerText.includes('выписка') || lowerText.includes('revolut business') || lowerText.includes('revolut bank') || lowerText.includes('account statement')) {
                                        console.log(`[Email] Detected Bank Statement PDF: ${attachment.filename || 'unknown'}`);
                                        const parsedTransactions = await parseBankStatementWithAI(rawContent);

                                        if (parsedTransactions && Array.isArray(parsedTransactions)) {
                                            for (const tx of parsedTransactions) {
                                                await reconcilePayment(tx.reference || '', tx.description || '', tx.amount, tx.date || (new Date().toISOString().split('T')[0]));
                                            }
                                            console.log(`[Email] Email UID ${id} successfully processed as PDF Bank Statement!`);
                                        }
                                    } else {
                                        // Parse regular PDF invoice with OpenAI
                                        const parsedData = await parseInvoiceDataWithAI(rawContent, companyName, customRules);
                                        if (await saveParsedData(parsedData)) {
                                            console.log(`[Email] Email UID ${id} successfully processed!`);
                                        }
                                    }
                                }
                            } else if (mime.includes('image/') || filename.endsWith('.jpg') || filename.endsWith('.jpeg') || filename.endsWith('.png')) {
                                console.log(`[Image] Native Image detected: ${filename}. Sending directly to Vision AI...`);
                                const base64Data = attachment.content.toString('base64');
                                const parsedData = await parseInvoiceImageWithAI(base64Data, companyName, customRules);
                                if (await saveParsedData(parsedData)) {
                                    console.log(`[Email] Email UID ${id} successfully processed from Image Attachment!`);
                                }
                            } else {
                                // Default for CSV and readable texts
                                rawContent = attachment.content.toString('utf-8');

                                // --- Detect Bank Statement (Revolut/Wise format check) ---
                                if (rawContent.includes('Date started (UTC)') && rawContent.includes('State') && rawContent.includes('Reference')) {
                                    console.log(`[Email] Detected Bank Statement CSV: ${attachment.filename}`);
                                    await processBankStatement(rawContent);
                                    console.log(`[Email] Email UID ${id} successfully processed as Bank Statement!`);
                                } else {
                                    // Treat as regular invoice text/csv, parse with OpenAI
                                    const parsedData = await parseInvoiceDataWithAI(rawContent, companyName, customRules);
                                    if (await saveParsedData(parsedData)) {
                                        console.log(`[Email] Email UID ${id} successfully processed!`);
                                    }
                                }
                            }
                        } catch (err) {
                            console.error(`[Error] Failed to process attachment ${filename}:`, err);
                        }
                    }
                }
            } else {
                console.log(`[Email] No attachments found in email. Parsing email body for invoices...`);
                const emailBody = parsedEmail.text || parsedEmail.html || '';
                if (emailBody.trim().length > 10) {
                    const parsedData = await parseInvoiceDataWithAI(emailBody, companyName, customRules);
                    if (parsedData && parsedData.length > 0) {
                        parsedData.forEach(inv => inv.companyId = companyId);
                        await writeToFirestore(parsedData);
                        console.log(`[Email] Email UID ${id} successfully processed from body text!`);
                    } else {
                        console.log(`[Email] AI found no invoices in body text.`);
                    }
                }
            }
        }

        connection.end();
        console.log(`[System] IMAP connection closed for ${companyName}.`);
    } catch (error) {
        console.error(`[Email Error] IMAP Failure for ${companyName} (${config.imap.user}):`, error);
    }
}

async function pollAllCompanyInboxes() {
    console.log('[System] Polling all company inboxes...');
    try {
        // 1. Check default backend .env inbox first (unless it's disabled or empty)
        if (process.env.IMAP_USER && process.env.IMAP_PASSWORD && process.env.IMAP_HOST) {
            await checkEmailForInvoices({
                user: process.env.IMAP_USER,
                password: process.env.IMAP_PASSWORD,
                host: process.env.IMAP_HOST,
                port: process.env.IMAP_PORT
            }, "Global Backend Default");
        }

        // 2. Query Firestore for company-specific inboxes
        const companiesSnapshot = await db.collection('companies').get();
        for (const doc of companiesSnapshot.docs) {
            const data = doc.data();
            if (data.imapHost && data.imapUser && data.imapPassword) {
                const customConfig = {
                    user: data.imapUser,
                    password: data.imapPassword,
                    host: data.imapHost.trim(),
                    port: data.imapPort || 993
                };
                await checkEmailForInvoices(customConfig, data.name, doc.id, data.customAiRules || "");
            }
        }
    } catch (err) {
        console.error('[System Error] Failed to poll company inboxes:', err);
    }
}

// Start the process immediately
pollAllCompanyInboxes();

// Keep script alive to run every 1 minute
console.log('Automated Invoice Processor Started. Checking every 60 seconds...');
setInterval(pollAllCompanyInboxes, 60000);

// --- CLOUD HOSTING & API SUPPORT ---
// Render.com and frontend Dashboard require a web server to bind to a PORT.
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
    // Enable CORS for all requests from the frontend
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            try {
                const { message } = JSON.parse(body);
                if (!message) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Message is required' }));
                    return;
                }

                // AI Chat Filter Logic
                const today = new Date().toISOString().split('T')[0];
                const response = await openai.chat.completions.create({
                    model: "gpt-4o",
                    messages: [
                        {
                            role: "system",
                            content: `You are an AI assistant managing an invoice tracking system. 
Today's date is ${today}. 
The user will ask you a question in natural language about their invoices. 
Your goal is to translate their intent into specific table filter parameters and a polite reply.
You MUST output ONLY valid JSON matching this schema exactly:
{
  "filters": {
    "searchTerm": "vendor name or ID if mentioned, else empty string",
    "status": "Paid, Pending, Overdue, Unpaid, or All",
    "dateFilterType": "due or created. Use 'due' if the user asks about payment deadlines (до, оплатить), use 'created' if they ask about when it was issued/received",
    "dateFrom": "YYYY-MM-DD if a start date is implied, else empty string",
    "dateTo": "YYYY-MM-DD if an end date/deadline is implied, else empty string"
  },
  "reply": "A short, polite conversational response acknowledging the action (in the user's language, usually Russian)"
}

Example 1: "Покажи неоплаченные счета до конца марта"
{"filters": {"searchTerm":"", "status":"Unpaid", "dateFilterType":"due", "dateFrom":"", "dateTo":"2026-03-31"}, "reply": "Конечно, вот ваши неоплаченные счета до конца марта."}

Example 2: "Сколько я должен заплатить Теле2 на этой неделе?"
{"filters": {"searchTerm":"Tele2", "status":"Unpaid", "dateFilterType":"due", "dateFrom":"", "dateTo":"2026-03-08"}, "reply": "Отфильтровал неоплаченные счета от Tele2 до конца текущей недели."}

Example 3: "Покажи счета за январь"
{"filters": {"searchTerm":"", "status":"All", "dateFilterType":"created", "dateFrom":"2026-01-01", "dateTo":"2026-01-31"}, "reply": "Показываю все счета, созданные в январе."}
`
                        },
                        {
                            role: "user",
                            content: message
                        }
                    ],
                    temperature: 0.1,
                    response_format: { type: "json_object" }
                });

                const aiOutput = JSON.parse(response.choices[0].message.content);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(aiOutput));
            } catch (error) {
                console.error("[API Error] /api/chat failed:", error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error processing AI response.' }));
            }
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.write('🤖 Invoice Automation Bot is Active & Running!');
        res.end();
    }
}).listen(PORT, () => {
    console.log(`[Web] HTTP server listening on port ${PORT} (API & Healthchecks).`);
});

module.exports = { parseInvoiceDataWithAI, writeToFirestore, reconcilePayment, pollAllCompanyInboxes };
