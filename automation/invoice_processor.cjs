require('dotenv').config({ path: __dirname + '/.env' });
const { reportError } = require('./error_reporter.cjs');
const { safetyNetSave } = require('./safety_net.cjs');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
const { validateAndTeach } = require('./teacher_agent.cjs');
const { uploadInvoiceToPDF, buildDropboxFolderPath } = require('./dropbox_service.cjs');

// Firebase Admin Initialization (Shared Core)
const { admin, db, bucket } = require('./core/firebase.cjs');
// Staging layer — saves raw docs before processing for re-run without IMAP
const { stageDocument, markStagingResult } = require('./core/staging.cjs');
// Number parsing — single source of truth for European/US decimal formats
const { cleanNum } = require('./core/utils.cjs');
// Merit Aktiva sync — sends invoices automatically
const { syncInvoiceToMerit } = require('./merit_sync.cjs');

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

            // Format amount as number (European/US decimal aware via cleanNum)
            const numAmount = cleanNum(data.amount);

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

            // --- SELF-INVOICE GUARD (last-resort check before write) ---
            // Receiver companies (Global Technics, Ideacom, ...) can never be the vendor.
            // If Teacher/Accountant guards missed it, this final check catches the case.
            try {
                const companiesSnap = await db.collection('companies').get();
                const invVat = (data.supplierVat || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                const invReg = (data.supplierRegistration || '').replace(/[^0-9]/g, '');
                const invName = (vendorName || '').toLowerCase().replace(/[^a-zöäüõ0-9]/g, '');
                for (const cd of companiesSnap.docs) {
                    const c = cd.data();
                    const cVat = (c.vat || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
                    const cReg = (c.regCode || '').replace(/[^0-9]/g, '');
                    const cName = (c.name || '').toLowerCase().replace(/[^a-zöäüõ0-9]/g, '');
                    const vatLeak = cVat && invVat && (cVat === invVat || invVat.endsWith(cReg || 'XXXXXX'));
                    const regLeak = cReg && invReg && cReg === invReg;
                    const nameLeak = cName && invName && invName.length > 3 &&
                        (cName === invName || invName.includes(cName) || cName.includes(invName));
                    if (vatLeak || regLeak || nameLeak) {
                        console.error(`[Firestore] 🛑 SELF-INVOICE GUARD: Buyer data leaked into vendor fields for ${vendorName}/${invoiceId} (matches ${c.name}). Record rejected.`);
                        throw new Error(`SELF_INVOICE_GUARD: Buyer "${c.name}" data in vendor fields`);
                    }
                }
            } catch (guardErr) {
                if (guardErr.message && guardErr.message.startsWith('SELF_INVOICE_GUARD')) {
                    throw guardErr; // re-throw to skip write
                }
                // Firestore read errors are non-critical — continue write
                console.warn(`[Firestore] Self-invoice guard check failed: ${guardErr.message}`);
            }

            // --- DUPLICATE PREVENTION LOGIC ---
            // Queries are run OUTSIDE the transaction: Firestore Admin SDK supports
            // query reads inside transactions, but under concurrent load the snapshot
            // may be stale. Running queries before acquiring the transaction write lock
            // is the recommended pattern for high-throughput dedup.
            let isDuplicate = false;
            let existingDocId = null;

            // 0. Check by file source: if same file was already saved → duplicate.
            // Denorm fileBasename as indexed field for O(1) lookup via composite index
            // (companyId, fileBasename). Falls back to full scan for legacy records
            // that don't have the field yet.
            let currentFileBasename = '';
            if (data.fileUrl) {
                currentFileBasename = (data.fileUrl.match(/\d+_([^?]+)/)?.[1] || '').toLowerCase();
                if (currentFileBasename) {
                    // Fast path: composite index on (companyId, fileBasename)
                    const indexedSnap = await invoicesRef
                        .where('companyId', '==', data.companyId)
                        .where('fileBasename', '==', currentFileBasename)
                        .limit(1)
                        .get();
                    if (!indexedSnap.empty) {
                        console.log(`[Firestore] Duplicate caught by filename match (indexed): ${currentFileBasename}`);
                        isDuplicate = true;
                        existingDocId = indexedSnap.docs[0].id;
                    } else {
                        // Fallback for legacy records without fileBasename field.
                        // Only runs if the indexed query returned nothing.
                        const legacySnap = await invoicesRef
                            .where('companyId', '==', data.companyId)
                            .where('fileBasename', '==', null)
                            .limit(500)
                            .get();
                        for (const doc of legacySnap.docs) {
                            const existingFile = doc.data().fileUrl || '';
                            const existingBasename = (existingFile.match(/\d+_([^?]+)/)?.[1] || '').toLowerCase();
                            if (existingBasename && existingBasename === currentFileBasename) {
                                console.log(`[Firestore] Duplicate caught by filename match (legacy scan): ${currentFileBasename}`);
                                isDuplicate = true;
                                existingDocId = doc.id;
                                break;
                            }
                        }
                    }
                }
            }

            // 1. Check by Invoice ID + Vendor Name + Company
            if (!isDuplicate && data.invoiceId) {
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
                    const currDoc = await invoicesRef.doc(existingDocId).get();
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

            let finalStatus = data.status && data.status !== 'Pending' ? data.status : (data.isPaid ? 'Paid' : 'Pending');

            // --- CREDIT INVOICE OFFSET LOGIC ---
            if (numAmount < 0) {
                finalStatus = 'Paid'; // Credit invoices don't need payment
                const targetAmount = Math.abs(numAmount);

                // Filter by companyId to prevent cross-company credit note matching (Rule 10).
                // Limit to 200 to avoid unbounded reads on large datasets.
                const pendingQuery = data.companyId
                    ? invoicesRef.where('companyId', '==', data.companyId).where('status', '!=', 'Paid').limit(200)
                    : invoicesRef.where('status', '!=', 'Paid').limit(200);
                // Read pending invoices OUTSIDE transaction scope to avoid "Transaction too big":
                // each invoice can hold up to 50KB rawText, so 200 docs = ~10MB in transaction payload.
                const pendingSnapshot = await pendingQuery.get();

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
                fileBasename: currentFileBasename || null,  // Indexed for O(1) dedup via (companyId, fileBasename)
                stagingId: data.stagingId || null,  // Link to raw_documents entry for source tracing
                rawText: (data._rawText || '').slice(0, 50000) || null  // Full text for Repairman re-extraction
            });
            delete data._rawText;  // Clean up internal field after saving

            // Merit Aktiva sync — non-blocking (don't fail invoice save if Merit is down)
            try {
                await syncInvoiceToMerit(data, docRef.id);
            } catch (meritErr) {
                console.warn(`[Merit] Sync failed (non-blocking): ${meritErr.message}`);
            }

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

        // --- DROPBOX UPLOAD ---
        if (process.env.DROPBOX_ACCESS_TOKEN) {
            for (const payload of webhooksToSend) {
                try {
                    if (!payload.fileUrl) continue;
                    const cId = payload.companyId;
                    const companyDoc = cId ? await db.collection('companies').doc(cId).get() : null;
                    const companyName = companyDoc?.exists ? (companyDoc.data().name || '') : '';

                    const folderPath = buildDropboxFolderPath(companyName, payload.invoiceYear, payload.invoiceMonth);

                    // Скачать PDF из Firebase Storage и загрузить в Dropbox
                    const { default: fetch } = await import('node-fetch');
                    const pdfRes = await fetch(payload.fileUrl);
                    if (!pdfRes.ok) throw new Error(`Failed to download PDF: ${pdfRes.status}`);
                    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

                    const dropboxPath = await uploadInvoiceToPDF(payload.invoiceId, pdfBuffer, folderPath);
                    console.log(`[Dropbox] ✅ Uploaded ${payload.invoiceId} → ${dropboxPath}`);
                } catch (dbxErr) {
                    console.error(`[Dropbox] ❌ Upload failed for ${payload.invoiceId}:`, dbxErr.message);
                }
            }
        } else {
            if (webhooksToSend.length > 0) {
                console.warn(`[Dropbox] ⚠️  DROPBOX_ACCESS_TOKEN not set — skipping upload for ${webhooksToSend.length} invoice(s)`);
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
        const teacherResult = await validateAndTeach(tempParsed[0], companyId, tempParsed[0]._rawText || '');
        tempParsed[0] = teacherResult.invoice;

        if (teacherResult.corrections && teacherResult.corrections.length > 0) {
            console.log(`[Teacher] Corrections applied: ${teacherResult.corrections.join('; ')}`);
        }

        if (!teacherResult.approved) {
            console.warn(`[Teacher] ⚠️  Invoice not fully approved — missing fields remain.`);
            tempParsed[0].validationWarnings = tempParsed[0].validationWarnings || [];
            tempParsed[0].validationWarnings.push('TEACHER: Not all 11 mandatory fields filled');

            // Step 3: Claude "second opinion" for math mismatch (once per invoice)
            const sub = cleanNum(tempParsed[0].subtotalAmount);
            const tax = cleanNum(tempParsed[0].taxAmount);
            const amt = cleanNum(tempParsed[0].amount);
            if (amt > 0 && sub > 0 && Math.abs(sub + tax - amt) > 0.50) {
                try {
                    const { askClaudeToFix } = require('./document_ai_service.cjs');
                    const rawText = tempParsed[0]._rawText || '';
                    const fixes = await askClaudeToFix(rawText, tempParsed[0],
                        [`sub(${sub}) + tax(${tax}) = ${(sub+tax).toFixed(2)} ≠ amount(${amt})`]);
                    if (fixes && Object.keys(fixes).length > 0) {
                        // CURRENCY RULE: if Claude changes currency, amount must be re-extracted
                        // from rawText in the new currency. Apply currency + amount together.
                        if (fixes.currency !== undefined && fixes.currency !== tempParsed[0].currency) {
                            tempParsed[0].currency = fixes.currency;
                            // Claude's own amount in the new currency is authoritative here
                            if (fixes.amount !== undefined) tempParsed[0].amount = fixes.amount;
                            if (fixes.subtotalAmount !== undefined) tempParsed[0].subtotalAmount = fixes.subtotalAmount;
                            if (fixes.taxAmount !== undefined) tempParsed[0].taxAmount = fixes.taxAmount;
                            console.log(`[Claude QC] Currency ${sub > 0 ? '→' : 'set to'} ${fixes.currency}, amount=${fixes.amount}`);
                        } else {
                            if (fixes.amount !== undefined) tempParsed[0].amount = fixes.amount;
                            if (fixes.subtotalAmount !== undefined) tempParsed[0].subtotalAmount = fixes.subtotalAmount;
                            if (fixes.taxAmount !== undefined) tempParsed[0].taxAmount = fixes.taxAmount;
                        }
                        if (fixes.isPaid) tempParsed[0].status = 'Paid';
                        console.log(`[Claude QC] Applied fixes in Scout pipeline`);
                    }
                    tempParsed[0].claudeFixAttempted = true;
                } catch (claudeErr) {
                    console.warn(`[Claude QC] ⚠️ Scout pipeline error: ${claudeErr.message}`);
                }
            }
        }
    } catch (teacherErr) {
        console.warn(`[Teacher] ⚠️  Validation error (proceeding with Scout data): ${teacherErr.message}`);
    }

    // Keep _rawText for Firestore save, remove after
    return tempParsed;
}

module.exports = { uploadToStorage, parseInvoiceDataWithAI, writeToFirestore, scoutTeacherPipeline };
