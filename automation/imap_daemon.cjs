require('dotenv').config({ path: __dirname + '/.env' });
const { reportError } = require('./error_reporter.cjs');
const { safetyNetSave } = require('./safety_net.cjs');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const pdfParse = require('pdf-parse');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
const { validateAndTeach } = require('./teacher_agent.cjs');
const { auditAndProcessInvoice } = require('./accountant_agent.cjs');
const { runDashboardAudit } = require('./dashboard_auditor_agent.cjs');
const { parse } = require('csv-parse/sync');

// Firebase Admin Initialization (Shared Core)
const { admin, db, bucket } = require('./core/firebase.cjs');
// Staging layer — saves raw docs before processing for re-run without IMAP
const { stageDocument, markStagingResult } = require('./core/staging.cjs');

// --- DYNAMIC DICTIONARY ENGINE (Node.js Memory Cache) ---
const companyAliasCache = {};
const companyAliasCacheTime = {};

async function getVendorAliases(companyId) {
    let defaultAliases = {
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
    if (!companyId) return defaultAliases;

    const now = Date.now();
    // Cache TTL: 30 minutes
    if (companyAliasCache[companyId] && now - companyAliasCacheTime[companyId] < 1800000) {
        return { ...defaultAliases, ...companyAliasCache[companyId] };
    }

    try {
        const doc = await db.collection('companies').doc(companyId).get();
        if (doc.exists && doc.data().vendorAliases) {
            // Cap cache to 100 entries to prevent unbounded growth
            if (Object.keys(companyAliasCache).length >= 100) {
                const oldestKey = Object.keys(companyAliasCacheTime).sort((a, b) => companyAliasCacheTime[a] - companyAliasCacheTime[b])[0];
                delete companyAliasCache[oldestKey];
                delete companyAliasCacheTime[oldestKey];
            }
            companyAliasCache[companyId] = doc.data().vendorAliases;
            companyAliasCacheTime[companyId] = now;
            return { ...defaultAliases, ...doc.data().vendorAliases };
        } else {
            companyAliasCache[companyId] = {};
            companyAliasCacheTime[companyId] = now;
            return defaultAliases;
        }
    } catch (e) {
        console.error(`[Dictionary Error] Failed to fetch aliases for ${companyId}: ${e.message}`);
        return defaultAliases;
    }
}

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
 * 1. Body-text parsing (DEPRECATED — DocAI requires PDF/image file)
 */
async function parseInvoiceDataWithAI(rawText, companyName = "GLOBAL TECHNICS OÜ", customRules = "") {
    console.warn(`[DocAI] ⚠️  Body-text email for "${companyName}" skipped — Google Document AI requires a PDF or image file. Forward the original invoice PDF.`);
    return null;
}

/**
 * 2. Writes the parsed JSON data array to Firebase Firestore
 */
async function writeToFirestore(dataArray) {
    if (!dataArray || !Array.isArray(dataArray) || dataArray.length === 0) return;

    try {
        console.log(`[Firestore] Adding ${dataArray.length} invoice(s) to database via Atomic Transaction...`);
        const invoicesRef = db.collection('invoices');
        const webhooksToSend = [];

        for (const data of dataArray) {
          try {
            await db.runTransaction(async (t) => {
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

            // --- IDEACOM VENDOR-SPECIFIC DUE DATE RULE (FALLBACK) ---
            // Pronto and Inovatus invoice Ideacom OÜ on net-30 terms.
            // This rule is a FALLBACK: it only fires if the AI did not already calculate
            // a distinct dueDate via customAiRules (i.e. dueDate equals dateCreated or is absent).
            // If customAiRules is set in company Settings and handles this vendor, it takes priority.
            const IDEACOM_ID = 'vlhvA6i8d3Hry8rtrA3Z';
            const lowerVendor = vendorName.toLowerCase();
            const aiAlreadySetDueDate = data.dueDate && data.dueDate !== data.dateCreated;
            if (data.companyId === IDEACOM_ID && !aiAlreadySetDueDate &&
                (lowerVendor.includes('pronto') || lowerVendor.includes('inovatus'))) {
                if (data.dateCreated) {
                    const parts = data.dateCreated.includes('-') ? data.dateCreated.split('-') : data.dateCreated.split('.');
                    if (parts.length === 3) {
                        let day, month, year;
                        if (parts[0].length === 4) { // YYYY-MM-DD
                            year = parseInt(parts[0], 10); month = parseInt(parts[1], 10) - 1; day = parseInt(parts[2], 10);
                        } else { // DD-MM-YYYY
                            day = parseInt(parts[0], 10); month = parseInt(parts[1], 10) - 1; year = parseInt(parts[2], 10);
                        }
                        if (year < 2000) year += 2000;
                        const d = new Date(year, month, day);
                        d.setDate(d.getDate() + 30);
                        data.dueDate = `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
                        console.log(`[Ideacom Rule] Fallback +30 days dueDate for ${vendorName}: ${data.dueDate}`);
                    }
                }
            }

            // --- FILE INTEGRITY CHECK (Rule 31: no file = no record) ---
            // IMPORTANT: throw, do NOT silently return.
            // A silent return would cause saveParsedData() to set success=true
            // and mark the email as \\Seen — making it invisible to the next poll.
            // Throwing forces success=false so the email stays UNSEEN and retried.
            if (!data.fileUrl) {
                throw new Error(`FILE_INTEGRITY_BLOCK: No fileUrl for ${vendorName} / ${invoiceId}. Record not saved.`);
            }

            // --- DUPLICATE PREVENTION LOGIC ---
            // Queries are run OUTSIDE the transaction: Firestore Admin SDK supports
            // query reads inside transactions, but under concurrent load the snapshot
            // may be stale. Running queries before acquiring the transaction write lock
            // is the recommended pattern for high-throughput dedup.
            let isDuplicate = false;
            let existingDocId = null;

            // 1. Check by Invoice ID + Vendor Name + Company
            if (data.invoiceId) {
                const idQuerySnap = await invoicesRef.where('invoiceId', '==', invoiceId).get();
                for (const doc of idQuerySnap.docs) {
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
                const dateQuerySnap = await invoicesRef
                    .where('dateCreated', '==', data.dateCreated)
                    .where('amount', '==', numAmount)
                    .get();

                for (const doc of dateQuerySnap.docs) {
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
                    const currDoc = await t.get(invoicesRef.doc(existingDocId));
                    if (!currDoc.data().fileUrl) {
                        console.log(`[Firestore] Patching duplicate invoice with missing fileUrl: ${vendorName} - ${invoiceId}`);
                        t.update(invoicesRef.doc(existingDocId), {
                            fileUrl: data.fileUrl
                        });
                    } else {
                        console.log(`[Firestore] Audit Guard: Refusing to overwrite existing valid fileUrl for duplicate invoice: ${vendorName} - ${invoiceId}`);
                    }
                } else {
                    console.log(`[Firestore] Skipping duplicate invoice: ${vendorName} - ${invoiceId}`);
                }
                return; // CRITICAL: This bypasses both Firestore creation AND Webhook scheduling below 
            }

            let finalStatus = data.status && data.status !== 'Pending' ? data.status : (data.isPaid ? 'Paid' : 'Unpaid');

            // --- CREDIT INVOICE OFFSET LOGIC ---
            if (numAmount < 0) {
                finalStatus = 'Paid'; // Credit invoices don't need payment
                const targetAmount = Math.abs(numAmount);

                // Filter by companyId to prevent cross-company credit note matching (Rule 10).
                // Limit to 200 to avoid unbounded reads on large datasets.
                const pendingQuery = data.companyId
                    ? invoicesRef.where('companyId', '==', data.companyId).where('status', '!=', 'Paid').limit(200)
                    : invoicesRef.where('status', '!=', 'Paid').limit(200);
                const pendingSnapshot = await t.get(pendingQuery);

                for (const potentialOffset of pendingSnapshot.docs) {
                    const passData = potentialOffset.data();
                    if (Math.abs((passData.amount || 0) - targetAmount) <= 0.05) {
                        const v1 = String(vendorName).toLowerCase().replace(/[^a-z0-9]/g, '');
                        const v2 = String(passData.vendorName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (v1 && v2 && (v1.includes(v2) || v2.includes(v1))) {
                            console.log(`[Credit-Offset] Matched credit invoice to original invoice ${passData.invoiceId} (Amount: ${passData.amount}). Marking original as Paid.`);
                            t.update(potentialOffset.ref, { status: 'Paid' });
                            break; 
                        }
                    }
                }
            }

            // Sanitize description: reject strings that look like invoice IDs / registration numbers
            // (only digits, or digits+slashes+hyphens with no real words, or >10 consecutive digits)
            const rawDesc = data.description
                || (data.lineItems && data.lineItems[0] && data.lineItems[0].description)
                || '';
            const looksLikeId = /^[\d\/\-\.]+$/.test(rawDesc.trim()) || /\d{7,}/.test(rawDesc);
            const cleanDescription = (rawDesc && !looksLikeId) ? rawDesc.trim() : '';

            t.set(docRef, {
                invoiceId: invoiceId,
                vendorName: vendorName,
                amount: numAmount,
                subtotalAmount: Number(data.subtotalAmount) || 0,
                taxAmount: Number(data.taxAmount) || 0,
                currency: data.currency || 'EUR',
                dateCreated: data.dateCreated || '',
                // invoiceYear/Month: AI outputs YYYY-MM-DD → [0]=year, [1]=month
                // Legacy fallback for DD.MM.YYYY → split(".")[2]=year, split(".")[1]=month
                invoiceYear: data.dateCreated
                    ? (data.dateCreated.includes('-') ? data.dateCreated.split("-")[0] : data.dateCreated.split(".")[2])
                    : new Date().getFullYear().toString(),
                invoiceMonth: data.dateCreated
                    ? parseInt(data.dateCreated.includes('-') ? data.dateCreated.split("-")[1] : (data.dateCreated.split(".")[1] || "1"), 10).toString()
                    : (new Date().getMonth() + 1).toString(),
                dueDate: data.dueDate || '',
                status: finalStatus,
                supplierRegistration: data.supplierRegistration || "",
                supplierVat: data.supplierVat || "",
                validationWarnings: data.validationWarnings || [],
                description: cleanDescription,
                lineItems: data.lineItems || [],
                originalAmount: numAmount,       // Never changes — original invoice total
                remainingAmount: numAmount,      // Decreases with partial payments
                payments: [],                    // Payment history: [{amount, date, reference}]
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                companyId: data.companyId || null,
                fileUrl: data.fileUrl || null,
                stagingId: data.stagingId || null  // Link to raw_documents entry for source tracing
            });

            if (!data.companyId) {
                console.error(`[Firestore] ⚠️  companyId missing for invoice ${invoiceId} (vendor: ${vendorName}). Saved without company — manual review required.`);
            }

            webhooksToSend.push({
                invoiceId: invoiceId,
                vendorName: vendorName,
                amount: numAmount,
                currency: data.currency || 'EUR',
                dateCreated: data.dateCreated || '',
                invoiceYear: data.dateCreated
                    ? (data.dateCreated.includes('-') ? data.dateCreated.split("-")[0] : data.dateCreated.split(".")[2])
                    : new Date().getFullYear().toString(),
                invoiceMonth: data.dateCreated
                    ? parseInt(data.dateCreated.includes('-') ? data.dateCreated.split("-")[1] : (data.dateCreated.split(".")[1] || "1"), 10).toString()
                    : (new Date().getMonth() + 1).toString(),
                dueDate: data.dueDate || '',
                status: finalStatus,
                fileUrl: data.fileUrl || null,
                companyId: data.companyId || null
            });
            }); // END INDIVIDUAL TRANSACTION BLOCK
          } catch (txErr) {
            const vendorName = data.vendorName || 'Unknown';
            const invoiceId = data.invoiceId || 'Unknown';
            console.error(`[Firestore] ❌ Transaction failed for invoice ${invoiceId} (${vendorName}):`, txErr.message);
            await reportError('TRANSACTION_FAILED', `${vendorName} / ${invoiceId}`, txErr).catch(() => {});
          }
        }

        console.log(`[Firestore] ${dataArray.length} invoice(s) successfully written via Transaction!`);

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
 * Scout → Teacher pipeline for a single document.
 * Step 1 (Scout): DocAI + regex extraction
 * Step 2 (Teacher): validation against Charter + ground-truth examples
 * @param {Buffer} content - Raw file content
 * @param {string} mimeType - MIME type (e.g. 'application/pdf', 'image/jpeg')
 * @param {string} companyId - Company ID for Teacher lookup
 * @param {string} customRules - Company customAiRules text
 * @returns {Array|null} Parsed invoice data array, or null if extraction failed
 */
async function scoutTeacherPipeline(content, mimeType, companyId, customRules) {
    // Step 1: Scout — DocAI + multilingual regex
    const tempParsed = await processInvoiceWithDocAI(content, mimeType, null, customRules || '');
    if (!tempParsed || tempParsed.length === 0) return null;

    // Step 2: Teacher — validate and fill from Charter + examples
    try {
        const teacherResult = await validateAndTeach(tempParsed[0], companyId);
        tempParsed[0] = teacherResult.invoice;

        if (teacherResult.corrections && teacherResult.corrections.length > 0) {
            console.log(`[Teacher] Corrections applied: ${teacherResult.corrections.join('; ')}`);
        }

        if (!teacherResult.approved) {
            console.warn(`[Teacher] ⚠️  Invoice not fully approved — missing fields remain.`);
            tempParsed[0].validationWarnings = tempParsed[0].validationWarnings || [];
            tempParsed[0].validationWarnings.push('TEACHER: Not all 11 mandatory fields filled');
        }
    } catch (teacherErr) {
        console.warn(`[Teacher] ⚠️  Validation error (proceeding with Scout data): ${teacherErr.message}`);
    }

    return tempParsed;
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
        // Map commercial product names to official legal entity names utilizing the new dynamic caching engine
        const vendorAliases = await getVendorAliases(companyId);
        
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
                    
                    await db.runTransaction(async (t) => {
                        const freshDoc = await t.get(matchedDoc.ref);
                        if (!freshDoc.exists || freshDoc.data().status === 'Paid') return;
                        t.update(matchedDoc.ref, payoutData);
                    });
                    fxOverwriteTriggered = true;
                } else {
                    let payoutData = { status: 'Paid' };
                    if (bankFee > 0) {
                        console.log(`[Reconciliation] Rule 16 Executed: Storing Bank Transfer Fee (${bankFee}) and Total Drain (${totalBankDrain})`);
                        payoutData.bankFee = bankFee;
                        payoutData.totalBankDrain = totalBankDrain || paidAmount;
                    }
                    await db.runTransaction(async (t) => {
                        const freshDoc = await t.get(matchedDoc.ref);
                        if (!freshDoc.exists || freshDoc.data().status === 'Paid') return;
                        t.update(matchedDoc.ref, payoutData);
                    });
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
                        await db.runTransaction(async (t) => {
                            const freshDoc = await t.get(doc.ref);
                            if (!freshDoc.exists || freshDoc.data().status === 'Paid') return;
                            t.update(doc.ref, crossCurrencyPayload);
                        });
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
                await db.runTransaction(async (t) => {
                    const freshDoc = await t.get(docRef);
                    if (!freshDoc.exists || freshDoc.data().status === 'Paid') return;
                    t.update(docRef, globalPayload);
                });
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
                                await db.runTransaction(async (t) => {
                                    const freshDoc = await t.get(doc.ref);
                                    if (freshDoc.exists && freshDoc.data().status !== 'Paid') {
                                        t.update(doc.ref, { status: 'Paid' });
                                    }
                                });
                                // Keep scanning in case there are multiple
                            }
                        }
                    }
                }

            } else {
                const newAmount = data.amount - paidAmount;
                // If it was unpaid, mark as pending to show partial payment
                const newStatus = (data.status === 'Unpaid' || !data.status) ? 'Pending' : data.status;
                await db.runTransaction(async (t) => {
                    const freshDoc = await t.get(docRef);
                    if (freshDoc.exists) {
                        t.update(docRef, { amount: parseFloat(newAmount.toFixed(2)), status: newStatus });
                    }
                });
                console.log(`  -> Partial payment. Remaining: €${newAmount.toFixed(2)}. Status: ${newStatus}`);
            }
        } else {
            console.log(`[Reconciliation] No pending invoice match for payment €${paidAmount} (Ref: ${reference}, Desc: ${description})`);
        }

        // ── Save transaction to bank_transactions archive ──────────────
        try {
            await db.collection('bank_transactions').add({
                companyId: companyId || null,
                date: paymentDateStr || null,
                amount: paidAmount,
                totalBankDrain: totalBankDrain || paidAmount,
                bankFee: bankFee || 0,
                reference: reference || '',
                counterparty: description || '',
                foreignAmount: foreignAmount || null,
                foreignCurrency: foreignCurrency || null,
                matchedInvoiceId: matchedDoc ? matchedDoc.id : null,
                matchedInvoiceNumber: matchedDoc ? matchedDoc.data().invoiceId : null,
                savedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        } catch (archiveErr) {
            console.warn(`[Reconciliation] Failed to archive transaction: ${archiveErr.message}`);
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
 * PDF bank statements require Claude for text extraction — disabled.
 * Use CSV bank statement exports (Revolut/Wise CSV) instead — they work without AI.
 */
async function parseBankStatementWithAI(rawText) {
    console.warn('[DocAI] ⚠️  PDF bank statement parsing disabled (required Claude). Use CSV export from your bank instead.');
    return null;
}

/**
 * 4. Main IMAP function: Connects to email, finds UNSEEN messages with attachments
 */
async function checkEmailForInvoices(imapConfig, companyName = "Default", companyId = null, customRules = "") {
    if (!companyId) {
        console.error(`[Email] ⚠️  checkEmailForInvoices called without companyId for ${companyName}. Invoices may not be routed correctly.`);
    }
    const config = {
        imap: {
            user: imapConfig.user,
            password: imapConfig.password,
            host: imapConfig.host,
            port: imapConfig.port,
            tls: process.env.IMAP_TLS !== 'false', // Defaults to true; set IMAP_TLS=false only for non-TLS servers
            authTimeout: 30000, // Increased timeout 
            connTimeout: 30000, // Added connection timeout
            tlsOptions: { rejectUnauthorized: false } // Helps bypass strict SSL cert issues
        }
    };

    try {
        console.log(`[Email] Connecting to IMAP server ${config.imap.host} for ${companyName} (${config.imap.user})...`);

        // Retry with backoff on rate-limit errors (some IMAP servers throttle rapid reconnects)
        let connection;
        const MAX_IMAP_ATTEMPTS = 3;
        for (let attempt = 1; attempt <= MAX_IMAP_ATTEMPTS; attempt++) {
            try {
                connection = await imaps.connect(config);
                break;
            } catch (connErr) {
                const isRateLimit = /rate.limit|too many|429|login.wait/i.test(connErr.message);
                if (isRateLimit && attempt < MAX_IMAP_ATTEMPTS) {
                    const waitSec = attempt * 60; // 60s, 120s
                    console.warn(`[Email] ⚠️  IMAP rate limited for ${companyName} (attempt ${attempt}). Waiting ${waitSec}s...`);
                    await new Promise(r => setTimeout(r, waitSec * 1000));
                } else {
                    throw connErr; // rethrow to outer catch
                }
            }
        }
        if (!connection) throw new Error('IMAP connection failed after retries');

        console.log('[Email] Connection successful! Opening INBOX.');
        await connection.openBox('INBOX');

        const horizonDate = new Date();
        horizonDate.setDate(horizonDate.getDate() - 5); // Defeat Zapier: Sweep the last 3 days
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const sinceStr = `${String(horizonDate.getDate()).padStart(2, '0')}-${months[horizonDate.getMonth()]}-${horizonDate.getFullYear()}`;
        
        // Defeat Zapier: Do NOT rely on UNSEEN! Zapier marks it as seen instantly.
        // We poll ALL messages since 3 days ago, and use our own Firestore memory to deduplicate.
        const searchCriteria = [['SINCE', sinceStr]];
        // FIX Reliability: do NOT mark as seen on fetch — mark manually after successful Firestore write
        // This prevents losing invoices if PM2 crashes mid-processing
        const fetchOptions = { bodies: [''], markSeen: false };

        const allMessages = await connection.search(searchCriteria, fetchOptions);
        const messages = allMessages;
        console.log(`[Email] Found ${messages.length} total emails in the trailing 3-day recovery window.`);

        for (const item of messages) {
            const all = item.parts.find(a => a.which === '');
            const id = item.attributes.uid;
            
            // Defeat Zapier: Idempotent Sequence Memory Check
            const uidDocRef = db.collection('processed_email_uids').doc(`${companyId}_${id}`);
            const uidSnap = await uidDocRef.get();
            if (uidSnap.exists) {
                continue; // We already fully processed this UID successfully in the past
            }
            
            const parsedEmail = await simpleParser(all.body);

            console.log(`[Email] Processing email subject: "${parsedEmail.subject}"`);

            // Catch-all flag: set to true whenever UID is saved anywhere below.
            // At the end of this email's processing, if still false, we save the UID
            // to guarantee every email is touched at most once.
            let uidSaved = false;
            const saveUid = async (type = 'processed') => {
                if (uidSaved) return;
                try {
                    await uidDocRef.set({ processedAt: admin.firestore.FieldValue.serverTimestamp(), subject: parsedEmail.subject || '', type });
                    uidSaved = true;
                } catch (e) {
                    console.error(`[UID] ⚠️  Failed to save UID (type=${type}): ${e.message}`);
                }
            };

            // ★ COST FIX: skip billing/system emails that should never be processed as invoices
            // Without this, Anthropic billing receipts create a self-reinforcing loop:
            // API usage → billing email → daemon processes email → more API usage → more billing emails
            const senderAddress = (parsedEmail.from?.text || '').toLowerCase();
            const emailSubject  = (parsedEmail.subject || '').toLowerCase();
            const emailBodyText = (parsedEmail.text || '').substring(0, 1000).toLowerCase();
            
            const BILLING_SENDER_PATTERNS = [
                'anthropic', 'stripe.com', 'no-reply@', 'noreply@', 'donotreply@',
                'billing@', 'invoices@', 'receipts@', 'payments@', 'notifications@'
            ];
            const BILLING_SUBJECT_PATTERNS = [
                'your receipt', 'payment receipt', 'auto-recharge', 'payment confirmation',
                'invoice from anthropic', 'receipt from anthropic', 'subscription renewal',
                'payment processed', 'charge notification'
            ];
            
            const isBillingSender  = BILLING_SENDER_PATTERNS.some(p => senderAddress.includes(p));
            const isBillingSubject = BILLING_SUBJECT_PATTERNS.some(p => emailSubject.includes(p));
            // Defend against Gmail auto-forwarding replacing the original sender
            const isBillingBody = emailBodyText.includes('anthropic') && (emailBodyText.includes('receipt') || emailBodyText.includes('stripe') || emailBodyText.includes('charge'));

            if (isBillingSender || isBillingSubject || isBillingBody) {
                console.log(`[Email] 🚫 Skipping billing/system email: "${parsedEmail.subject}" from ${senderAddress}`);
                // Save UID so it's never touched again
                await saveUid('billing_skip');
                continue;
            }

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

                        // Staging ID — will be set once we know the document type and rawText
                        let stagingId = null;

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
                                    
                                    if (!auditedData) {
                                        console.warn(`[Accountant Agent] 🛑 Invoice rejected (record not saved). Email stays unseen.`);
                                        await markStagingResult(stagingId, { status: 'rejected', error: 'Accountant rejected record' });
                                        // success stays false → email stays UNSEEN for retry
                                    } else if (auditedData.status === 'Duplicate') {
                                        console.log(`[Accountant Agent] ℹ️ Duplicate detected — skipping.`);
                                        await markStagingResult(stagingId, { status: 'duplicate', resultIds: [] });
                                        success = true;
                                    } else {
                                        try {
                                            auditedData.stagingId = stagingId; // Back-link to raw_documents for source tracing
                                            await writeToFirestore([auditedData]);
                                            await markStagingResult(stagingId, { status: 'success', resultIds: [auditedData.id || auditedData.invoiceId || ''] });
                                            success = true;
                                        } catch (writeErr) {
                                            if (writeErr.message && writeErr.message.startsWith('FILE_INTEGRITY_BLOCK')) {
                                                // Record has no fileUrl — don't mark email as Seen,
                                                // it will be retried on the next poll cycle.
                                                console.error(`[Firestore] 🛑 ${writeErr.message}`);
                                                await markStagingResult(stagingId, { status: 'error', error: writeErr.message });
                                                // success stays false → email NOT marked \\Seen → retried
                                            } else {
                                                throw writeErr; // Genuine Firestore error — rethrow
                                            }
                                        }
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
                                const isBankStatement = lowerText.includes('выписка по счету') || lowerText.includes('konto väljavõte') || lowerText.includes('account statement');

                                // --- STAGE RAW DOCUMENT (PDF) ---
                                stagingId = await stageDocument({
                                    type: isBankStatement ? 'bank_statement' : 'invoice',
                                    companyId,
                                    source: {
                                        subject:    parsedEmail.subject || '',
                                        from:       parsedEmail.from?.text || '',
                                        date:       parsedEmail.date?.toString() || '',
                                        filename:   attachment.filename || filename,
                                        messageUid: id,
                                    },
                                    storageUrl: fileUrl,
                                    rawText:    rawContent,
                                });

                                if (isBankStatement) {
                                    console.log(`[Email] Detected Bank Statement PDF: ${attachment.filename || 'unknown'}`);
                                    const parsedTransactions = await parseBankStatementWithAI(rawContent);

                                    if (parsedTransactions && Array.isArray(parsedTransactions)) {
                                        for (const tx of parsedTransactions) {
                                            await reconcilePayment(tx.reference || '', tx.description || '', tx.amount, null, null, tx.date || (new Date().toISOString().split('T')[0]), null, null, companyId);
                                        }
                                        await markStagingResult(stagingId, { status: 'success', resultIds: [] });
                                        console.log(`[Email] Email UID ${id} successfully processed as PDF Bank Statement!`);
                                        try { connection.imap.addFlags(id, ['\\Seen'], () => {}); } catch(_) {}
                                        await saveUid('bank_statement');
                                    }
                                } else {
                                    // Invoice PDF — Scout → Teacher pipeline
                                    console.log('[Email] Detected Invoice PDF. Running Scout → Teacher pipeline...');

                                    const parsedData = await scoutTeacherPipeline(attachment.content, mime || 'application/pdf', companyId, customRules);
                                    if (await saveParsedData(parsedData)) {
                                        console.log(`[Email] Email UID ${id} successfully processed by Scout → Teacher!`);
                                        try { connection.imap.addFlags(id, ['\\Seen'], () => {}); } catch(_) {}
                                        await saveUid('invoice_pdf');
                                    }
                                }
                            } else if (mime.includes('image/') || filename.endsWith('.jpg') || filename.endsWith('.jpeg') || filename.endsWith('.png')) {
                                console.log(`[Image] Native Image detected: ${filename}. Requesting Vision Audit...`);

                                // --- STAGE RAW DOCUMENT (Image) ---
                                stagingId = await stageDocument({
                                    type: 'image_invoice',
                                    companyId,
                                    source: {
                                        subject:    parsedEmail.subject || '',
                                        from:       parsedEmail.from?.text || '',
                                        date:       parsedEmail.date?.toString() || '',
                                        filename:   attachment.filename || filename,
                                        messageUid: id,
                                    },
                                    storageUrl: fileUrl,
                                    rawText:    null, // images have no raw text
                                });

                                // Image invoice — Scout → Teacher pipeline
                                console.log('[Image] Running Scout → Teacher pipeline for image...');

                                const parsedData = await scoutTeacherPipeline(attachment.content, mime, companyId, customRules);
                                if (await saveParsedData(parsedData)) {
                                    console.log(`[Email] Email UID ${id} successfully processed by Scout → Teacher from Image!`);
                                    try { connection.imap.addFlags(id, ['\\Seen'], () => {}); } catch(_) {}
                                    await saveUid('invoice_image');
                                }
                            } else {
                                // Default for CSV and readable texts
                                rawContent = attachment.content.toString('utf-8');

                                // --- Prevent Binary Leakage ---
                                if ((mime && mime.includes('image')) || filename.endsWith('.gif') || filename.endsWith('.heic') || filename.endsWith('.bmp')) {
                                    console.log(`[System] Ignoring unsupported binary image format: ${filename}`);
                                    await saveUid('unsupported_format');
                                    continue;
                                }

                                // --- Detect Bank Statement (Revolut/Wise format check) ---
                                const isCsvBankStatement = rawContent.includes('Date started (UTC)') && rawContent.includes('State') && rawContent.includes('Reference');

                                // --- STAGE RAW DOCUMENT (CSV) ---
                                stagingId = await stageDocument({
                                    type: isCsvBankStatement ? 'bank_statement' : 'invoice',
                                    companyId,
                                    source: {
                                        subject:    parsedEmail.subject || '',
                                        from:       parsedEmail.from?.text || '',
                                        date:       parsedEmail.date?.toString() || '',
                                        filename:   attachment.filename || filename,
                                        messageUid: id,
                                    },
                                    storageUrl: fileUrl,
                                    rawText:    rawContent,
                                });

                                if (isCsvBankStatement) {
                                    console.log(`[Email] Detected Bank Statement CSV: ${attachment.filename}`);
                                    await processBankStatement(rawContent, companyId);
                                    await markStagingResult(stagingId, { status: 'success', resultIds: [] });
                                    console.log(`[Email] Email UID ${id} successfully processed as Bank Statement!`);
                                    await saveUid('bank_statement_csv');
                                } else {
                                    // Treat as regular invoice text/csv, parse with Claude
                                    const parsedData = await parseInvoiceDataWithAI(rawContent, companyName, customRules);
                                    if (await saveParsedData(parsedData)) {
                                        console.log(`[Email] Email UID ${id} successfully processed!`);
                                        await saveUid('invoice_csv');
                                    }
                                }
                            }
                        } catch (err) {
                            console.error(`[Error] Failed to process attachment ${filename}:`, err);
                            await markStagingResult(stagingId, { status: 'error', error: err.message });
                            // Safety Net: save a DRAFT if we have a file (fileUrl may be null if upload also failed)
                            const saved = await safetyNetSave(
                                { vendorName: 'UNKNOWN (pipeline exception)', invoiceId: `ATTACHMENT-${Date.now()}` },
                                `Pipeline exception: ${err.message}`,
                                companyId,
                                fileUrl  // may be null — Safety Net will reject without file and log warning
                            ).catch(() => null);
                            if (!saved) console.warn(`[Safety Net] Invoice lost for ${filename}: pipeline exception AND no file. Original error: ${err.message}`);
                            // Save UID so this broken attachment is not retried indefinitely
                            await saveUid('pipeline_exception');
                        }
                    }
                }
            } else {
                // ⚠️  NO ATTACHMENT PATH — body text only.
                // This path is a last resort. The Completeness Gate in accountant_agent.cjs
                // will reject any body-text record that doesn't have vendor + amount + invoiceId + VAT/reg.
                // Records without a PDF file should NOT appear on the dashboard as skeleton entries.
                console.warn(`[Email] ⚠️  Email UID ${id} has NO attachments. Attempting body-text parse (Completeness Gate active).`);
                const emailBody = parsedEmail.text || parsedEmail.html || '';
                if (emailBody.trim().length <= 10) {
                    console.log(`[Email] UID ${id} has empty body — skipping.`);
                    await saveUid('empty_body');
                } else if (emailBody.trim().length > 10) {
                    const parsedData = await parseInvoiceDataWithAI(emailBody, companyName, customRules);
                    if (parsedData && parsedData.length > 0) {
                        for (let inv of parsedData) {
                            inv.companyId = companyId;
                            try {
                                // Step A: Teacher validation for body-text invoices
                                try {
                                    const teacherResult = await validateAndTeach(inv, companyId);
                                    Object.assign(inv, teacherResult.invoice);
                                    if (!teacherResult.approved) {
                                        console.warn(`[Email] Body-text invoice has missing fields after Teacher validation.`);
                                    }
                                } catch (teachErr) {
                                    console.warn(`[Email] Teacher error on body-text: ${teachErr.message}`);
                                }

                                // Step B: Completeness Gate (score 4/4) + Cross-company routing
                                // 'BODY_TEXT_NO_ATTACHMENT' triggers the Completeness Gate in accountant_agent.cjs
                                const auditedData = await auditAndProcessInvoice(inv, inv.fileUrl || 'BODY_TEXT_NO_ATTACHMENT', companyId);
                                if (!auditedData) {
                                    console.warn(`[Email] Body-text invoice rejected by Accountant.`);
                                    await saveUid('body_text_rejected');
                                } else if (auditedData.status === 'Duplicate') {
                                    await saveUid('body_text_duplicate');
                                } else {
                                    try {
                                        await writeToFirestore([auditedData]);
                                        console.log(`[Email] Body-text invoice saved: ${auditedData.vendorName} / ${auditedData.invoiceId}`);
                                        await saveUid('body_text_invoice');
                                    } catch (writeErr) {
                                        if (writeErr.message && writeErr.message.startsWith('FILE_INTEGRITY_BLOCK')) {
                                            console.warn(`[Email] Body-text write blocked (no file): ${writeErr.message}`);
                                            await saveUid('body_text_no_file');
                                        } else {
                                            throw writeErr;
                                        }
                                    }
                                }
                            } catch (auditErr) {
                                if (auditErr.message !== 'BANK_STATEMENT_RECONCILIATION_COMPLETE') {
                                    console.error(`[Email] Audit error for body-text invoice:`, auditErr.message);
                                }
                            }
                        }
                    } else {
                        console.log(`[Email] AI found no invoices in body text of UID ${id}.`);
                        await saveUid('no_invoice_found');
                    }
                } // end else if emailBody.trim().length > 10
            } // end else (no attachments)

            // ★ FINAL CATCH-ALL: if none of the paths above saved the UID, save now.
            // This guarantees every email in the sweep window is processed exactly once,
            // regardless of which code path was taken.
            await saveUid('catch_all');
        } // end for each email

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
                // Trim all values — Firestore UI can introduce leading/trailing spaces
                const customConfig = {
                    user:     (data.imapUser    || '').trim(),
                    password: (data.imapPassword || '').trim(),
                    host:     (data.imapHost     || '').trim(),
                    port:     data.imapPort || 993
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

// Start the process only when run directly (not when imported as a module)
if (require.main === module) {
    checkAndRunFlagTasks().then(() => {
        pollLoop();
        auditLoop();
    });
}

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

module.exports = { checkEmailForInvoices, parseInvoiceDataWithAI, writeToFirestore, reconcilePayment, pollAllCompanyInboxes };
