require('dotenv').config({ path: __dirname + '/.env' });
const { reportError } = require('./error_reporter.cjs');
const { safetyNetSave } = require('./safety_net.cjs');
const { intellectualSupervisorGate } = require('./supreme_supervisor.cjs');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const Anthropic = require('@anthropic-ai/sdk');
const pdfParse = require('pdf-parse');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
const { classifyDocumentWithVision } = require('./vision_auditor.cjs');
const { auditAndProcessInvoice } = require('./accountant_agent.cjs');
const { runDashboardAudit } = require('./dashboard_auditor_agent.cjs');
const { parse } = require('csv-parse/sync');

// Initialize Anthropic API
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
const bucket = admin.storage().bucket('invoice-tracker-xyz.firebasestorage.app');

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
 * 1. AI Parsing: Sends raw text (or CSV string) to Claude to extract fields
 */
async function parseInvoiceDataWithAI(rawText, companyName = "GLOBAL TECHNICS OÜ", customRules = "") {
    console.log(`[AI] Parsing raw data with Claude for company: ${companyName}...`);

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
CRITICAL ENGLISH INVOICE RULE: If you see "Bill To", the company listed under it is the BUYER. If you see "Recipient" alongside bank details (IBAN/Account), that company is the VENDOR receiving the money.
If an invoice is issued by "FS Teenused OÜ" to "${companyName}", the vendorName MUST be "FS Teenused OÜ".
If the invoice is clearly addressed to a COMPLETELY DIFFERENT BUYER (e.g., "Chempack OÜ" or someone else) and NOT to "${companyName}" or "GLOBAL TECHNICS OÜ", YOU MUST REJECT IT and return an empty array [].

CRITICAL RULE FOR REJECTING NON-INVOICE DOCUMENTS:
You MUST ONLY extract true Invoices (Arve, Invoice, Rechnung, Lasku).
If the document is primarily a Receipt (Kviitung, Tšekk, Kvito), a Waybill/CMR (Saateleht, Veoseleht, CMR), a Quote/Proforma (Pakkumine, Proforma, Ettemaksuarve), an Order (Tellimus), Insurance Policy (Poliis), Contract (Leping), or has NO clear amount to pay, YOU MUST REJECT IT and return an empty array []. Do NOT extract a "Kviitung" as an invoice. Do not falsely reject valid invoices just because the text is messy.

Required fields for EACH invoice object:
- invoiceId: (e.g. Inv-006, Dok. nr. CRITICAL: NEVER use a generic string like "Arve nr." or "Invoice". It MUST be the actual unique alphanumeric number next to it)
- vendorName: (The EXACT company issuing the invoice, NEVER ${companyName} and NEVER GLOBAL TECHNICS OÜ)
- amount: (Number only. Final total amount for the current period, EXCLUDING past debt)
- currency: (3 letter code, usually EUR)
- dateCreated: (DD-MM-YYYY format. CRITICAL: Provide the actual issuing date, not the print/export date)
- dueDate: (DD-MM-YYYY format. If no explicit due date, use dateCreated)
- description: (String, max 3-4 words. Guess based on vendor if not explicit)
- isPaid: (Boolean. Set to true ONLY IF the invoice explicitly states it is already paid, e.g., "Amount Due 0.00", "Amount Due EUR 0.00", "Makstud", "Paid", "Оплачен". Otherwise, false.)

${customRulesSection}Raw Data:
${rawText}
`;
    try {
        const response = await require('./ai_retry.cjs').createWithRetry(anthropic, {
            model: "claude-sonnet-4-6",
            max_tokens: 1500,
            temperature: 0.1,
            system: "You are an expert accountant system.",
            messages: [{ role: "user", content: prompt }]
        });

        // Depending on response structure from Anthropic, text is typically in content[0].text
        const jsonString = response.content[0].text.trim();

        // Extract just the JSON array, ignoring any potential conversational text or markdown blocks
        const match = jsonString.match(/\[[\s\S]*\]/);
        const cleanJson = match ? match[0] : '[]';

        const parsedArray = JSON.parse(cleanJson);

        // --- PRE-PROCESSING HOOK FOR TRICKY VENDORS ---
        parsedArray.forEach(invoice => {
            if (invoice.vendorName && invoice.vendorName.toLowerCase().includes('result group')) {

                // Extract real ID 
                // e.g. 260228.9
                const idMatch = rawText.match(/(\d{6}\.\d{1,2})/);
                if (idMatch && idMatch[1]) {
                    invoice.invoiceId = idMatch[1];
                }

            }
        });

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
 * 2. Writes the parsed JSON data array to Firebase Firestore
 */
async function writeToFirestore(dataArray) {
    if (!dataArray || !Array.isArray(dataArray) || dataArray.length === 0) return;

    try {
        console.log(`[Firestore] Adding ${dataArray.length} invoice(s) to database...`);
        const batch = db.batch();
        const invoicesRef = db.collection('invoices');
        const webhooksToSend = [];

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

            // --- FILE INTEGRITY CHECK ---
            if (!data.fileUrl) {
                console.warn(`[Firestore] 🛑 CRITICAL REJECTION: Refusing to write invoice without a file attachment (Vendor: ${vendorName}, Invoice: ${invoiceId}). Audit block active.`);
                continue; // Completely bypass Firebase write
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
                    // Prevent AI hallucinations (mistaking 39 for 41) from maliciously overwriting the real 41's PDF.
                    // Only patch the fileUrl if the existing record in the DB is completely empty (no file attached).
                    const currDoc = await invoicesRef.doc(existingDocId).get();
                    if (!currDoc.data().fileUrl) {
                        console.log(`[Firestore] Patching duplicate invoice with missing fileUrl: ${vendorName} - ${invoiceId}`);
                        batch.update(invoicesRef.doc(existingDocId), {
                            fileUrl: data.fileUrl
                        });
                    } else {
                        console.log(`[Firestore] Audit Guard: Refusing to overwrite existing valid fileUrl for duplicate invoice: ${vendorName} - ${invoiceId}`);
                    }
                } else {
                    console.log(`[Firestore] Skipping duplicate invoice: ${vendorName} - ${invoiceId}`);
                }
                continue; // CRITICAL: This bypasses both Firestore creation AND Webhook scheduling below 
            }

            let finalStatus = data.status && data.status !== 'Pending' ? data.status : (data.isPaid ? 'Paid' : 'Unpaid');

            // --- CREDIT INVOICE OFFSET LOGIC ---
            if (numAmount < 0) {
                finalStatus = 'Paid'; // Credit invoices don't need payment
                const targetAmount = Math.abs(numAmount);

                const pendingSnapshot = await invoicesRef.where('status', '!=', 'Paid').get();

                for (const potentialOffset of pendingSnapshot.docs) {
                    const passData = potentialOffset.data();
                    if (Math.abs((passData.amount || 0) - targetAmount) <= 0.05) {
                        const v1 = String(vendorName).toLowerCase().replace(/[^a-z0-9]/g, '');
                        const v2 = String(passData.vendorName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (v1 && v2 && (v1.includes(v2) || v2.includes(v1))) {
                            console.log(`[Credit-Offset] Matched credit invoice to original invoice ${passData.invoiceId} (Amount: ${passData.amount}). Marking original as Paid.`);
                            batch.update(potentialOffset.ref, { status: 'Paid' });
                            break; 
                        }
                    }
                }
            }

            batch.set(docRef, {
                invoiceId: invoiceId,
                vendorName: vendorName,
                amount: numAmount,
                subtotalAmount: Number(data.subtotalAmount) || 0,
                taxAmount: Number(data.taxAmount) || 0,
                currency: data.currency || 'EUR',
                dateCreated: data.dateCreated || '',
                invoiceYear: data.dateCreated ? data.dateCreated.split("-")[2] || data.dateCreated.split(".")[2] : new Date().getFullYear().toString(),
                invoiceMonth: data.dateCreated ? parseInt(data.dateCreated.split("-")[1] || data.dateCreated.split(".")[1] || "1", 10).toString() : (new Date().getMonth() + 1).toString(),
                dueDate: data.dueDate || '',
                status: finalStatus,
                supplierRegistration: data.supplierRegistration || "",
                supplierVat: data.supplierVat || "",
                validationWarnings: data.validationWarnings || [],
                lineItems: data.lineItems || [],
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                companyId: data.companyId || 'bP6dc0PMdFtnmS5QTX4N',
                fileUrl: data.fileUrl || null
            });

            webhooksToSend.push({
                invoiceId: invoiceId,
                vendorName: vendorName,
                amount: numAmount,
                currency: data.currency || 'EUR',
                dateCreated: data.dateCreated || '',
                invoiceYear: data.dateCreated ? data.dateCreated.split("-")[2] || data.dateCreated.split(".")[2] : new Date().getFullYear().toString(),
                invoiceMonth: data.dateCreated ? parseInt(data.dateCreated.split("-")[1] || data.dateCreated.split(".")[1] || "1", 10).toString() : (new Date().getMonth() + 1).toString(),
                dueDate: data.dueDate || '',
                status: finalStatus,
                fileUrl: data.fileUrl || null,
                companyId: data.companyId || 'bP6dc0PMdFtnmS5QTX4N'
            });
        }

        await batch.commit();
        console.log(`[Firestore] ${dataArray.length} invoice(s) successfully written!`);

        // --- ZAPIER WEBHOOKS DISPATCH ---
        for (const payload of webhooksToSend) {
            try {
                const cId = payload.companyId;
                const companyDoc = await db.collection('companies').doc(cId).get();
                if (companyDoc.exists) {
                    const compData = companyDoc.data();
                    if (compData.zapierWebhookUrl) {
                        console.log(`[Zapier] Sending webhook to Zapier for Invoice ${payload.invoiceId}...`);
                        payload.companyName = compData.name || '';

                        // --- DYNAMIC DROPBOX ROUTING ---
                        let folderBasePath = "UNKNOWN_COMPANY";
                        let folderPrefix = "UK";

                        const compNameUpper = payload.companyName.toUpperCase();
                        if (compNameUpper.includes("IDEACOM")) {
                            folderBasePath = "IDEACOM";
                            folderPrefix = "IC";
                        } else if (compNameUpper.includes("GLOBAL TECHNICS")) {
                            folderBasePath = "GLOBAL TECHNICS";
                            folderPrefix = "GT";
                        }

                        // e.g. /GLOBAL TECHNICS/GT_ARVED/GT_arved_meile/GT_arved_meile_2026/GT_arved_meile_2026_3
                        payload.dropboxFolderPath = `/${folderBasePath}/${folderPrefix}_ARVED/${folderPrefix}_arved_meile/${folderPrefix}_arved_meile_${payload.invoiceYear}/${folderPrefix}_arved_meile_${payload.invoiceYear}_${payload.invoiceMonth}`;

                        const response = await fetch(compData.zapierWebhookUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });

                        if (response.ok) {
                            console.log(`[Zapier] Webhook delivered successfully for ${payload.invoiceId}`);
                        } else {
                            console.error(`[Zapier Error] Zapier responded with ${response.status} ${response.statusText}`);
                        }
                    }
                }
            } catch (zErr) {
                console.error(`[Zapier Error] Failed to dispatch webhook for ${payload.invoiceId}:`, zErr.message);
            }
        }

    } catch (error) {
        console.error('[Firestore Error] Database upload failed:', error.message);
        await reportError('FIREBASE_WRITE_ERROR', 'Batch/Multiple', error).catch(() => {});
    }
}

/**
 * Runs the Maker-Checker AI extraction loop for a single document.
 * Shared by both PDF and Image processing paths.
 * @param {Buffer} content - Raw file content
 * @param {string} mimeType - MIME type (e.g. 'application/pdf', 'image/jpeg')
 * @param {Object} companyData - Company config including customAiRules
 * @param {number} maxAttempts - Max retry attempts (default 5)
 * @returns {Array|null} Parsed invoice data array, or null if extraction failed
 */
async function runMakerCheckerLoop(content, mimeType, companyData, maxAttempts = 5) {
    let parsedData = null;
    let extractionAttempts = 0;
    let critique = null;

    while (!parsedData && extractionAttempts < maxAttempts) {
        extractionAttempts++;
        const tempParsed = await processInvoiceWithDocAI(content, mimeType, critique, companyData.customAiRules);

        if (!tempParsed || tempParsed.length === 0) break;

        const supervisorVerdict = await intellectualSupervisorGate(tempParsed[0]);

        if (!supervisorVerdict.passed && supervisorVerdict.needsReExtraction) {
            console.log(`[Supervisor 🗣️ Engine] MISSING DATA! Rerunning extraction: ${supervisorVerdict.critique}`);
            critique = supervisorVerdict.critique;

            if (extractionAttempts >= maxAttempts) {
                console.log(`[Supervisor] ⚠️ Max reflection attempts reached. Accepting with missing data flag.`);
                tempParsed[0].validationWarnings = tempParsed[0].validationWarnings || [];
                tempParsed[0].validationWarnings.push(`SUPERVISOR: Forced to accept missing data after deep scan.`);
                tempParsed[0].status = 'ANOMALY_DETECTED';
                parsedData = tempParsed;
            }
        } else if (!supervisorVerdict.passed && !supervisorVerdict.needsReExtraction) {
            console.log(`[Supervisor] 🚨 ANOMALY STRIKE: ${supervisorVerdict.reason}`);
            tempParsed[0].status = 'ANOMALY_DETECTED';
            tempParsed[0].validationWarnings = tempParsed[0].validationWarnings || [];
            tempParsed[0].validationWarnings.push(`SUPERVISOR STRIKE: ${supervisorVerdict.reason}`);
            parsedData = tempParsed;
        } else {
            parsedData = tempParsed;
        }
    }

    return parsedData;
}

/**
 * 3. Bank Reconciliation Logic
 */
async function reconcilePayment(reference, description, paidAmount, totalBankDrain = null, bankFee = null, paymentDateStr = null, foreignAmount = null, foreignCurrency = null, companyId = null) {
    try {
        const invoicesRef = db.collection('invoices');
        let matchedDoc = null;
        let isCrossCurrencyMatch = false;
        let fxOverwriteTriggered = false;

        const normalizeString = (str) => String(str || '').toLowerCase().trim();
        const normalizeAlphaNum = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        // Fetch only invoices for this company (performance: avoid full collection scan)
        const snapshot = companyId
            ? await invoicesRef.where('companyId', '==', companyId).get()
            : await invoicesRef.get();
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

        // --- VENDOR ALIASES (THE SYNONYMOUS MERCHANT PROTOCOL) ---
        // Map commercial product names from local bank statements to official legal parent entity names in the registry
        const vendorAliases = {
            'elron': 'eesti liinirongid as',
            'www.elron.ee': 'eesti liinirongid as',
            'claude': 'anthropic',
            'chatgpt': 'openai',
            'openai': 'openai',
            'youtube': 'google',
            'aws': 'amazon',
            'bolt': 'inredz',
            'wolt': 'wolt'
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

        // 0. Unified Priority Matrix for Bank Payments
        let candidates = [];
        
        const assessCandidate = (doc, isPaid) => {
            const data = doc.data();
            const invoiceAmount = parseFloat(data.amount) || 0;
            
            // Allow exact match OR explicitly reported Foreign Amount match from the bank
            const isAmountMatch = Math.abs(invoiceAmount - paidAmount) <= 0.05 || 
                                  (foreignAmount !== null && Math.abs(invoiceAmount - foreignAmount) <= 0.05);

            const dbId = normalizeAlphaNum(data.invoiceId);
            const dbDigits = extractDigits(data.invoiceId);
            
            const vendorWords = (data.vendorName || '').toLowerCase().split(/[^a-z0-9]/).filter(w => w.length >= 3);
            const vNameMatch = vendorWords.some(word => bankDesc.includes(word));
            
            let refMatchScore = 0;
            if (dbId) {
                if (dbId === bankRefClean) refMatchScore = 150; 
                else if (dbDigits.length >= 4 && refDigits.length >= 4 && (dbDigits === refDigits)) refMatchScore = 100;
                // Min 5 chars for substring to prevent short historic IDs ('2603') from hijacking new active IDs ('260399843')
                else if (dbId.length >= 5 && bankRefClean.includes(dbId)) refMatchScore = 50; 
            }

            if (isAmountMatch) {
                if (refMatchScore > 0 || vNameMatch) {
                    let totalScore = refMatchScore;
                    if (vNameMatch) totalScore += 25;
                    // Extreme priority bias: Unpaid identical bills ALWAYS beat Paid identical bills
                    if (!isPaid) totalScore += 500;   
                    
                    candidates.push({ doc, isPaid, totalScore });
                }
            }
        };

        paidDocs.forEach(d => assessCandidate(d, true));
        pendingDocs.forEach(d => assessCandidate(d, false));

        if (candidates.length > 0) {
            candidates.sort((a,b) => b.totalScore - a.totalScore);
            const winner = candidates[0];
            
            if (winner.isPaid) {
                console.log(`[Reconciliation] Skipping payment €${paidAmount} (${description}): Highest priority candidate is ALREADY PAID historic invoice ${winner.doc.data().invoiceId}`);
                return; // Suppress payload
            } else {
                matchedDoc = winner.doc;
                console.log(`[Reconciliation] Priority Match Winner: €${paidAmount} -> ${matchedDoc.data().vendorName} (Invoice: ${matchedDoc.data().invoiceId})`);
                
                // Rule 13: FX Overwrite Check for Priority Winner
                const originalAmount = parseFloat(matchedDoc.data().amount) || 1;
                if (foreignAmount !== null && Math.abs(originalAmount - foreignAmount) <= 0.05 && Math.abs(originalAmount - paidAmount) > 0.05) {
                    const fxRatio = paidAmount / originalAmount;
                    console.log(`[Reconciliation] 💱 FX OVERWRITE: Priority Winner matched foreign bank amount. Adjusting payload to ${paidAmount} EUR (Ratio: ${fxRatio.toFixed(3)})`);
                    
                    let payoutData = { amount: paidAmount, currency: 'EUR', status: 'Paid' };
                    if (matchedDoc.data().subtotalAmount) payoutData.subtotalAmount = parseFloat((matchedDoc.data().subtotalAmount * fxRatio).toFixed(2));
                    if (matchedDoc.data().taxAmount) payoutData.taxAmount = parseFloat((matchedDoc.data().taxAmount * fxRatio).toFixed(2));
                    payoutData.originalForeignAmount = originalAmount;
                    payoutData.originalForeignCurrency = matchedDoc.data().currency || foreignCurrency || 'UNKNOWN';
                    
                    matchedDoc.ref.update(payoutData);
                    fxOverwriteTriggered = true;
                } else {
                    let payoutData = { status: 'Paid' };
                    if (bankFee > 0) {
                        console.log(`[Reconciliation] Rule 16 Executed: Storing Bank Transfer Fee (${bankFee}) and Total Drain (${totalBankDrain})`);
                        payoutData.bankFee = bankFee;
                        payoutData.totalBankDrain = totalBankDrain || paidAmount;
                    }
                    matchedDoc.ref.update(payoutData);
                }
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
                        const originalAmount = parseFloat(doc.data().amount) || 1;
                        const fxRatio = paidAmount / originalAmount;

                        console.log(`[Reconciliation] 💱 FX OVERWRITE by Date: ${data.vendorName} on ${pDate}. Adjusting from ${data.amount} ${data.currency} to ${paidAmount} EUR.`);
                        
                        let crossCurrencyPayload = { amount: paidAmount, currency: 'EUR', status: 'Paid' };
                        if (doc.data().subtotalAmount) crossCurrencyPayload.subtotalAmount = parseFloat((doc.data().subtotalAmount * fxRatio).toFixed(2));
                        if (doc.data().taxAmount) crossCurrencyPayload.taxAmount = parseFloat((doc.data().taxAmount * fxRatio).toFixed(2));
                        crossCurrencyPayload.originalForeignAmount = originalAmount;
                        crossCurrencyPayload.originalForeignCurrency = doc.data().currency || foreignCurrency || 'UNKNOWN';
                        
                        if (bankFee > 0) {
                            crossCurrencyPayload.bankFee = bankFee;
                            crossCurrencyPayload.totalBankDrain = totalBankDrain || paidAmount;
                        }
                        await doc.ref.update(crossCurrencyPayload);
                        data.amount = paidAmount; // Update local memory
                        break;
                    }
                }
            }
        }

        if (matchedDoc) {
            const data = matchedDoc.data();
            const docRef = matchedDoc.ref;

            console.log(`[Reconciliation] Matched payment €${paidAmount} to Invoice ${data.invoiceId} (Total: €${fxOverwriteTriggered ? paidAmount : data.amount})`);

            // If it's a cross-currency match, it's intrinsically fully Paid (bypass partial deduction check)
            if (isCrossCurrencyMatch || fxOverwriteTriggered || paidAmount >= (data.amount - 0.05)) {
                let globalPayload = { status: 'Paid' };
                if (bankFee > 0) {
                    globalPayload.bankFee = bankFee;
                    globalPayload.totalBankDrain = totalBankDrain || paidAmount;
                }
                await docRef.update(globalPayload);
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

async function processBankStatement(csvText, companyId = null) {
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
            let amount = parseFloat(amountStr.replace(/,/g, ''));
            if (isNaN(amount) || amount >= 0) continue; // Only process outgoing (negative)

            // Calculate exact target invoice amount vs total bank drain
            const rawExtractedAmount = Math.abs(amount);
            
            // Extract the transactional Fee if present (e.g., "0.20")
            let feeStr = row['Fee'] || row['Bank Fee'] || row['Комиссия'] || row['Teenustasu'] || '0';
            const bankFee = Math.abs(parseFloat(feeStr.replace(/,/g, ''))) || 0;

            let invoiceTargetAmount = rawExtractedAmount;
            let totalBankDrain = rawExtractedAmount;

            // If the CSV provides "Total amount" (99.35) and "Amount" (99.15), invoiceTargetAmount is 99.15 
            const explicitTargetStr = row['Amount'] || '';
            const explicitTarget = Math.abs(parseFloat(explicitTargetStr.replace(/,/g, ''))) || 0;
            
            if (explicitTarget > 0 && explicitTarget !== rawExtractedAmount) {
                invoiceTargetAmount = explicitTarget;
                totalBankDrain = Math.max(invoiceTargetAmount + bankFee, rawExtractedAmount);
            } else if (bankFee > 0 && rawExtractedAmount > bankFee) {
                // If the CSV only provided a total drain minus fee, reverse engineer the target
                invoiceTargetAmount = rawExtractedAmount - bankFee;
            }

            const reference = (row['Reference'] || '').trim();
            const dateStr = (row['Date started (UTC)'] || row['Completed Date'] || row['Date'] || '').trim();
            // Remove bank prefixes like "Получатель: " or "Оплата: " to get the raw vendor name
            let description = (row['Description'] || row['Payer'] || '').trim();
            description = description.replace(/^(получатель|оплата|зачисление|перевод):\s*/i, '');
            
            // Rule 13: Extract Foreign Metadata
            let origAmountStr = row['Original amount'] || row['Original Amount'] || row['Target amount'] || row['Original Amount/Currency'] || '';
            // If the bank fuses amount and currency "6.20 USD"
            let foreignAmountNum = parseFloat(origAmountStr.replace(/[^0-9.]/g, ''));
            const foreignAmount = isNaN(foreignAmountNum) ? null : Math.abs(foreignAmountNum);
            const foreignCurrency = (row['Original Currency'] || row['original currency'] || row['Target currency'] || '').trim();

            await reconcilePayment(reference, description, invoiceTargetAmount, totalBankDrain, bankFee, dateStr, foreignAmount, foreignCurrency, companyId);
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
    console.log('[AI] Parsing PDF Bank Statement with Claude...');

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
        const response = await require('./ai_retry.cjs').createWithRetry(anthropic, {
            model: "claude-haiku-4-5-20251001",
            max_tokens: 2000,
            temperature: 0.1,
            system: "You are an expert accountant system.",
            messages: [{ role: "user", content: prompt }]
        });

        const jsonString = response.content[0].text.trim();
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

        const horizonDate = new Date();
        horizonDate.setDate(horizonDate.getDate() - 30);
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const sinceStr = `${String(horizonDate.getDate()).padStart(2, '0')}-${months[horizonDate.getMonth()]}-${horizonDate.getFullYear()}`;
        
        const searchCriteria = ['UNSEEN', ['SINCE', sinceStr]];
        // FIX Reliability: do NOT mark as seen on fetch — mark manually after successful Firestore write
        // This prevents losing invoices if PM2 crashes mid-processing
        const fetchOptions = { bodies: [''], markSeen: false };

        const allMessages = await connection.search(searchCriteria, fetchOptions);
        const messages = allMessages;
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

                        // --- UPLOAD ORIGINAL ATTACHMENT TO STORAGE WITH RETRY ---
                        let fileUrl = null;
                        let uploadAttempts = 0;
                        while (uploadAttempts < 3 && !fileUrl) {
                            try {
                                uploadAttempts++;
                                console.log(`[Storage] Uploading ${filename} to Firebase Storage (Attempt ${uploadAttempts})...`);
                                fileUrl = await uploadToStorage(companyId, filename, mime, attachment.content);
                                console.log(`[Storage] Successfully uploaded! URL: ${fileUrl}`);
                            } catch (uploadError) {
                                console.error(`[Storage Error] Failed to upload ${filename} on attempt ${uploadAttempts}:`, uploadError.message || uploadError);
                                await reportError('STORAGE_UPLOAD_ERROR', filename, uploadError).catch(() => {});
                                if (uploadAttempts < 3) {
                                    await new Promise(res => setTimeout(res, 2000)); // wait 2s before retry
                                }
                            }
                        }

                        if (!fileUrl) {
                            console.error(`[Storage Critical] Failed to upload ${filename} after 3 attempts. No record will be saved (Rule 31: no file = no record).`);
                            await reportError('STORAGE_UPLOAD_CRITICAL', filename, new Error(`Upload failed after 3 attempts for ${filename}`)).catch(() => {});
                        }

                        // Helper to inject the generated URL, run the Accountant Agent Audit, and save
                        const saveParsedData = async (data) => {
                            if (data && Array.isArray(data) && data.length > 0) {
                                let success = false;
                                for (let inv of data) {
                                    inv.companyId = companyId;
                                    
                                    // --- DLQ INTERCEPTOR: IF CLOUD STORAGE REJECTS, SERIALIZE TO NVMe ---
                                    if (!fileUrl) {
                                        const { saveToDLQ } = require('./dlq_manager.cjs');
                                        const dlqId = saveToDLQ(companyId, filename, attachment.content, inv, 'STORAGE_CATASTROPHE');
                                        console.error(`[Safety Net] 💾 Firebase Storage failed. Serialized AI payload to DLQ: ${dlqId}`);
                                        success = true; // Mark as successfully captured by DLQ so email doesn't loop forever
                                        continue;
                                    }

                                    // Orchestrator Pre-flight & Audit (Phase 3)
                                    const auditedData = await auditAndProcessInvoice(inv, fileUrl, companyId);
                                    
                                    if (auditedData.status === 'Duplicate') {
                                        console.log(`[Accountant Agent] ℹ️ Duplicate detected — skipping.`);
                                        success = true;
                                    } else if (auditedData.status === 'Error') {
                                        console.error(`[Accountant Agent] 🛑 Invoice rejected with Error status.`);
                                        // Safety Net: save as DRAFT instead of discarding
                                        const warnings = auditedData.validationWarnings || [];
                                        await safetyNetSave(
                                            auditedData,
                                            warnings.join('; ') || 'Accountant Agent returned Error status',
                                            companyId,
                                            fileUrl
                                        ).catch(() => {});
                                        success = true;
                                    } else {
                                        await writeToFirestore([auditedData]);
                                        success = true;
                                    }
                                }
                                return success;
                            }
                            return false;
                        };

                        try {
                            if (mime.includes('pdf') || filename.endsWith('.pdf')) {
                                console.log('[PDF] Parsing PDF data...');
                                const pdfData = await pdfParse(attachment.content);
                                rawContent = pdfData.text;

                                // --- Detect Bank Statement vs Invoice ---
                                const lowerText = rawContent.toLowerCase();
                                if (lowerText.includes('выписка по счету') || lowerText.includes('konto väljavõte') || lowerText.includes('account statement')) {
                                    console.log(`[Email] Detected Bank Statement PDF: ${attachment.filename || 'unknown'}`);
                                    const parsedTransactions = await parseBankStatementWithAI(rawContent);

                                    if (parsedTransactions && Array.isArray(parsedTransactions)) {
                                        for (const tx of parsedTransactions) {
                                            await reconcilePayment(tx.reference || '', tx.description || '', tx.amount, null, null, tx.date || (new Date().toISOString().split('T')[0]), null, null, companyId);
                                        }
                                        console.log(`[Email] Email UID ${id} successfully processed as PDF Bank Statement!`);
                                    }
                                } else {
                                    console.log('[Email] Detected Invoice PDF. Requesting Pre-Flight Vision Audit to check for CMRs...');
                                    const visionClass = await classifyDocumentWithVision(attachment.content, mime || 'application/pdf');
                                    if (visionClass === null) {
                                        // Vision API failed — don't discard, proceed with extraction
                                        console.warn(`[Vision Auditor] ⚠️  API failure on ${filename} — skipping classification, proceeding with extraction.`);
                                    } else if (visionClass !== 'INVOICE') {
                                        console.log(`[Vision Auditor] 🚨 Skipping attachment ${attachment.filename}. Classified as: ${visionClass}`);
                                        // Safety Net: if filename suggests invoice but Vision rejected it, save as DRAFT for review
                                        const looksLikeInvoice = /inv|arve|faktur|rechnung|factura|facture/i.test(filename);
                                        if (looksLikeInvoice) {
                                            // File was already uploaded — pass fileUrl so Safety Net can attach it
                                            const saved = await safetyNetSave(
                                                { vendorName: 'UNKNOWN (Vision rejected)', invoiceId: `VISION-${filename}` },
                                                `Vision Auditor classified as ${visionClass} but filename suggests invoice`,
                                                companyId,
                                                fileUrl
                                            ).catch(() => null);
                                            if (!saved) console.warn(`[Safety Net] Could not save DRAFT for Vision-rejected ${filename} (no file uploaded)`);
                                        }
                                        continue;
                                    }
                                    // visionClass === null (API failure) or visionClass === 'INVOICE' — proceed
                                    console.log('[Email] Verified as INVOICE. Engaging Maker-Checker AI Loop...');

                                    const parsedData = await runMakerCheckerLoop(attachment.content, mime || 'application/pdf', { customAiRules: customRules });
                                    if (await saveParsedData(parsedData)) {
                                        console.log(`[Email] Email UID ${id} successfully processed by Document AI!`);
                                        // FIX Reliability: mark as seen only AFTER successful Firestore write
                                        try { connection.imap.addFlags(id, ['\\Seen'], () => {}); } catch(_) {}
                                    }
                                }
                            } else if (mime.includes('image/') || filename.endsWith('.jpg') || filename.endsWith('.jpeg') || filename.endsWith('.png')) {
                                console.log(`[Image] Native Image detected: ${filename}. Requesting Vision Audit...`);
                                const visionClass = await classifyDocumentWithVision(attachment.content, mime);
                                if (visionClass !== 'INVOICE') {
                                    console.log(`[Vision Auditor] 🚨 Skipping image ${attachment.filename}. Classified as: ${visionClass}`);
                                    const looksLikeInvoice = /inv|arve|faktur|rechnung|factura|facture/i.test(filename);
                                    if (looksLikeInvoice) {
                                        const saved = await safetyNetSave(
                                            { vendorName: 'UNKNOWN (Vision rejected)', invoiceId: `VISION-${filename}` },
                                            `Vision Auditor classified as ${visionClass} but filename suggests invoice`,
                                            companyId,
                                            fileUrl
                                        ).catch(() => null);
                                        if (!saved) console.warn(`[Safety Net] Could not save DRAFT for Vision-rejected image ${filename} (no file uploaded)`);
                                    }
                                    continue;
                                }

                                console.log('[Image] Verified. Engaging Maker-Checker AI Loop for Image...');

                                const parsedData = await runMakerCheckerLoop(attachment.content, mime, { customAiRules: customRules });
                                if (await saveParsedData(parsedData)) {
                                    console.log(`[Email] Email UID ${id} successfully processed by Document AI from Image!`);
                                    // FIX Reliability: mark as seen only AFTER successful Firestore write
                                    try { connection.imap.addFlags(id, ['\\Seen'], () => {}); } catch(_) {}
                                }
                            } else {
                                // Default for CSV and readable texts
                                rawContent = attachment.content.toString('utf-8');

                                // --- Prevent Binary Leakage ---
                                if ((mime && mime.includes('image')) || filename.endsWith('.gif') || filename.endsWith('.heic') || filename.endsWith('.bmp')) {
                                    console.log(`[System] Ignoring unsupported binary image format: ${filename}`);
                                    continue;
                                }

                                // --- Detect Bank Statement (Revolut/Wise format check) ---
                                if (rawContent.includes('Date started (UTC)') && rawContent.includes('State') && rawContent.includes('Reference')) {
                                    console.log(`[Email] Detected Bank Statement CSV: ${attachment.filename}`);
                                    await processBankStatement(rawContent, companyId);
                                    console.log(`[Email] Email UID ${id} successfully processed as Bank Statement!`);
                                } else {
                                    // Treat as regular invoice text/csv, parse with Claude
                                    const parsedData = await parseInvoiceDataWithAI(rawContent, companyName, customRules);
                                    if (await saveParsedData(parsedData)) {
                                        console.log(`[Email] Email UID ${id} successfully processed!`);
                                    }
                                }
                            }
                        } catch (err) {
                            console.error(`[Error] Failed to process attachment ${filename}:`, err);
                            // Safety Net: save a DRAFT if we have a file (fileUrl may be null if upload also failed)
                            const saved = await safetyNetSave(
                                { vendorName: 'UNKNOWN (pipeline exception)', invoiceId: `ATTACHMENT-${Date.now()}` },
                                `Pipeline exception: ${err.message}`,
                                companyId,
                                fileUrl  // may be null — Safety Net will reject without file and log warning
                            ).catch(() => null);
                            if (!saved) console.warn(`[Safety Net] Invoice lost for ${filename}: pipeline exception AND no file. Original error: ${err.message}`);
                        }
                    }
                }
            } else {
                console.log(`[Email] No attachments found in email. Parsing email body for invoices...`);
                const emailBody = parsedEmail.text || parsedEmail.html || '';
                if (emailBody.trim().length > 10) {
                    const parsedData = await parseInvoiceDataWithAI(emailBody, companyName, customRules);
                    if (parsedData && parsedData.length > 0) {
                        // FIX Bug 3: route body-text invoices through auditAndProcessInvoice()
                        // so they get cross-company routing, deduplication, and VIES checks
                        for (let inv of parsedData) {
                            inv.companyId = companyId;
                            try {
                                const auditedData = await auditAndProcessInvoice(inv, inv.fileUrl || 'BODY_TEXT_NO_ATTACHMENT', companyId);
                                if (auditedData.status !== 'Duplicate' && auditedData.status !== 'Error') {
                                    await writeToFirestore([auditedData]);
                                }
                            } catch (auditErr) {
                                if (auditErr.message !== 'BANK_STATEMENT_RECONCILIATION_COMPLETE') {
                                    console.error(`[Email] Audit error for body-text invoice:`, auditErr.message);
                                }
                            }
                        }
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
        await reportError('IMAP_ERROR', config.imap.user || companyId, error).catch(() => {});
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
        await reportError('SYSTEM_POLL_ERROR', 'All Inboxes', err).catch(() => {});
    }
}

// --- FLAG FILE TASK RUNNER ---
// Claude (Cowork) writes .flag files to automation/ to trigger tasks without manual intervention.
// PM2 watch mode detects the new file, restarts, and this block executes the task automatically.
async function checkAndRunFlagTasks() {
    const fs = require('fs');
    const path = require('path');
    const flagDir = __dirname;

    const flags = fs.readdirSync(flagDir).filter(f => f.endsWith('.flag'));
    if (flags.length === 0) return;

    console.log(`[Flag Runner] 🚩 Found ${flags.length} task flag(s). Executing...`);

    for (const flag of flags) {
        const flagPath = path.join(flagDir, flag);
        console.log(`[Flag Runner] ▶️  Running task: ${flag}`);

        // IMPORTANT: Delete the flag BEFORE running the task.
        // If we delete it after, PM2 watch may detect other file writes
        // (e.g. log files) and restart the process mid-task, causing an
        // infinite restart loop where the task never completes.
        try { fs.unlinkSync(flagPath); } catch (_) {}
        console.log(`[Flag Runner] 🗑  Flag removed pre-emptively: ${flag}`);

        // Run as a CHILD PROCESS (not via require) to give it a fully isolated
        // Node.js environment with its own Firebase/gRPC connection.
        // Requiring the module directly shares the gRPC state with index.js
        // and can cause Firebase queries to hang indefinitely.
        if (flag === 'RECOVER_NUNNER.flag') {
            const { spawn } = require('child_process');
            await new Promise((resolve) => {
                const scriptPath = path.join(flagDir, 'nunner_recover.cjs');
                console.log(`[Flag Runner] 🚀 Spawning: ${process.execPath} ${scriptPath}`);
                const child = spawn(process.execPath, [scriptPath], {
                    cwd: flagDir,
                    env: { ...process.env },
                    stdio: ['ignore', 'pipe', 'pipe']
                });
                child.stdout.on('data', (d) => process.stdout.write(`[Nunner] ${d}`));
                child.stderr.on('data', (d) => process.stderr.write(`[Nunner ERR] ${d}`));
                child.on('close', (code) => {
                    if (code !== 0) {
                        console.error(`[Flag Runner] ❌ Recovery process exited with code ${code}`);
                    } else {
                        console.log(`[Flag Runner] ✅ Recovery process complete (exit 0)`);
                    }
                    resolve();
                });
                child.on('error', (err) => {
                    console.error(`[Flag Runner] ❌ Failed to spawn recovery process:`, err.message);
                    resolve();
                });
            });
        }
        // Future flags can be added here:
        // if (flag === 'SOME_OTHER_TASK.flag') { ... }
    }
}

// API Server logic skips the background polling matrix completely.

// Overlap-safe IMAP polling daemon
console.log('Automated Invoice Processor Started. Checking every 5 minutes...');
async function pollLoop() {
    while (true) {
        try {
            await pollAllCompanyInboxes();
        } catch (err) {
            console.error('[Poll Loop Error] Critical failure in IMAP daemon:', err.message);
        }
        await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
    }
}

// Overlap-safe Post-Flight Auditor daemon
console.log('Dashboard Auditor Scheduled. Sweeping database every 2 hours...');
async function auditLoop() {
    // Initial delay so it doesn't run concurrently with the first IMAP poll
    await new Promise(resolve => setTimeout(resolve, 60000)); 
    while (true) {
        try {
            await runDashboardAudit();
        } catch (err) {
            console.error('[Audit Loop Error] Critical failure in Auditor daemon:', err.message);
        }
        await new Promise(resolve => setTimeout(resolve, 7200000));
    }
}

// --- CLOUD HOSTING & API SUPPORT ---
// Render.com and Railway require a web server to bind to a single PORT.
const app = require('./webhook_server.cjs');
const PORT = process.env.PORT || 3000;

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // AI Chat Filter Logic
        const today = new Date().toISOString().split('T')[0];
        const response = await require('./ai_retry.cjs').createWithRetry(anthropic, {
            model: "claude-sonnet-4-6",
            max_tokens: 1000,
            temperature: 0.1,
            system: `You are an AI assistant managing an invoice tracking system. 
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
`,
            messages: [{ role: "user", content: message }]
        });

        const jsonString = response.content[0].text.trim();
        const cleanJson = jsonString.replace(/^```json/g, '').replace(/^```/g, '').replace(/```$/g, '').trim();
        const aiOutput = JSON.parse(cleanJson);
        res.json(aiOutput);
    } catch (error) {
        console.error("[API Error] /api/chat failed:", error);
        res.status(500).json({ error: 'Internal server error processing AI response.' });
    }
});

app.get('/', (req, res) => {
    res.send('🤖 Invoice Automation Bot is Active & Running!');
});

app.listen(PORT, () => {
    console.log(`[Web] Express server listening on port ${PORT} (Webhook API & Chat & Healthchecks).`);
});

module.exports = { checkEmailForInvoices, parseInvoiceDataWithAI, writeToFirestore, reconcilePayment, pollAllCompanyInboxes };
