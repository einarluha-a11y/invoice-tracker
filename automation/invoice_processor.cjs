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
const { cleanNum, computeContentHash } = require('./core/utils.cjs');
// Date helpers — canonical year/month extraction so misformatted dates
// never silently fall back to month="1".
const { extractYearMonth } = require('./core/date_helpers.cjs');
const { inspectVendorFields } = require('./core/self_invoice_guard.cjs');
// Merit Aktiva sync — sends invoices automatically
const { syncInvoiceToMerit } = require('./merit_sync.cjs');
const debug = (...a) => process.env.DEBUG && console.log(...a);

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
        debug(`[Firestore] Adding ${dataArray.length} invoice(s) to database via Atomic Transaction...`);
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

            // --- FILE INTEGRITY CHECK (Rule 31: no file = no record) ---
            // IMPORTANT: throw, do NOT silently return.
            // A silent return would cause saveParsedData() to set success=true
            // and mark the email as \\Seen — making it invisible to the next poll.
            // Throwing forces success=false so the email stays UNSEEN and retried.
            if (!data.fileUrl) {
                throw new Error(`FILE_INTEGRITY_BLOCK: No fileUrl for ${vendorName} / ${invoiceId}. Record not saved.`);
            }

            // --- SELF-INVOICE GUARD (last-resort check before write — B3 unified) ---
            // Receiver companies (Global Technics, Ideacom, ...) can never be the vendor.
            // If Teacher/Accountant guards missed it, this final check catches the case.
            // Uses the shared inspector — same rules as Teacher and Accountant.
            try {
                const companiesSnap = await db.collection('companies').get();
                const receivers = companiesSnap.docs.map(d => d.data());
                // Pass the about-to-be-written vendor fields (note: vendorName came from
                // `data.vendorName || 'Unknown Vendor'` above, which we want to validate too)
                const probe = {
                    vendorName,
                    supplierVat: data.supplierVat,
                    supplierRegistration: data.supplierRegistration,
                };
                const report = inspectVendorFields(probe, receivers);
                if (report.leaked) {
                    console.error(
                        `[Firestore] 🛑 SELF-INVOICE GUARD: Buyer data leaked into vendor fields for ` +
                        `${vendorName}/${invoiceId} (matches ${report.matchedCompanyName}). Record rejected.`
                    );
                    throw new Error(`SELF_INVOICE_GUARD: Buyer "${report.matchedCompanyName}" data in vendor fields`);
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

            // 0a. A6 — Content hash dedup (most reliable, byte-exact).
            // Scans for same SHA-256 of the PDF across this company. For multi-doc
            // PDFs, contentHash is shared, so we also filter by docIndex so three
            // invoices from one 3-page PDF each get their own record.
            if (data.contentHash) {
                let q = invoicesRef.where('contentHash', '==', data.contentHash);
                if (data.companyId) q = q.where('companyId', '==', data.companyId);
                const hashSnap = await q.limit(10).get();
                for (const d of hashSnap.docs) {
                    const existing = d.data();
                    // Multi-doc guard: only consider it a duplicate if the docIndex matches
                    // (or both are single-doc / undefined).
                    const sameIndex = (existing.docIndex ?? null) === (data.docIndex ?? null);
                    if (sameIndex) {
                        debug(`[Firestore] Duplicate caught by contentHash: ${data.contentHash.slice(0,12)}... (existing doc ${d.id})`);
                        isDuplicate = true;
                        existingDocId = d.id;
                        break;
                    }
                }
            }

            // 0b. Check by file source: if same file was already saved → duplicate.
            // Denorm fileBasename as indexed field for O(1) lookup via composite index
            // (companyId, fileBasename). The legacy fallback (scanning records with
            // `fileBasename == null`) is skipped when contentHash already found a
            // match — that's the canonical dedup key, no need to pay the extra read.
            let currentFileBasename = '';
            if (!isDuplicate && data.fileUrl) {
                currentFileBasename = (data.fileUrl.match(/\d+_([^?]+)/)?.[1] || '').toLowerCase();
                if (currentFileBasename) {
                    // Fast path: composite index on (companyId, fileBasename)
                    const indexedSnap = await invoicesRef
                        .where('companyId', '==', data.companyId)
                        .where('fileBasename', '==', currentFileBasename)
                        .limit(1)
                        .get();
                    if (!indexedSnap.empty) {
                        debug(`[Firestore] Duplicate caught by filename match (indexed): ${currentFileBasename}`);
                        isDuplicate = true;
                        existingDocId = indexedSnap.docs[0].id;
                    } else {
                        // Legacy fallback: scan the small tail of records without the
                        // denormalized fileBasename field. Capped at 100 (down from 500)
                        // because the denorm field is now backfilled on every write and
                        // the legacy tail is tiny. Scan is per-insert overhead so keep
                        // it minimal.
                        const legacySnap = await invoicesRef
                            .where('companyId', '==', data.companyId)
                            .where('fileBasename', '==', null)
                            .limit(100)
                            .get();
                        for (const doc of legacySnap.docs) {
                            const existingFile = doc.data().fileUrl || '';
                            const existingBasename = (existingFile.match(/\d+_([^?]+)/)?.[1] || '').toLowerCase();
                            if (existingBasename && existingBasename === currentFileBasename) {
                                debug(`[Firestore] Duplicate caught by filename match (legacy scan): ${currentFileBasename}`);
                                isDuplicate = true;
                                existingDocId = doc.id;
                                break;
                            }
                        }
                    }
                }
            }

            // 1a. Check by Invoice ID + Vendor Name + Company
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
                        debug(`[Firestore] Duplicate caught by Date/Amount/Vendor match. Existing ID: ${existingData.invoiceId}, New ID: ${invoiceId}`);
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
                        debug(`[Firestore] Patching duplicate invoice with missing fileUrl: ${vendorName} - ${invoiceId}`);
                        t.update(invoicesRef.doc(existingDocId), {
                            fileUrl: data.fileUrl
                        });
                    } else {
                        debug(`[Firestore] Audit Guard: Refusing to overwrite existing valid fileUrl for duplicate invoice: ${vendorName} - ${invoiceId}`);
                    }
                } else {
                    debug(`[Firestore] Skipping duplicate invoice: ${vendorName} - ${invoiceId}`);
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
                            debug(`[Credit-Offset] Matched credit invoice to original invoice ${passData.invoiceId} (Amount: ${passData.amount}). Marking original as Paid.`);
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

            // Canonical year/month via shared helper — accepts ISO, DD.MM.YYYY,
            // DD/MM/YYYY, DD-MM-YYYY; falls back to today only when dateCreated
            // is actually missing (not when it's a truncated string).
            const ym = extractYearMonth(data.dateCreated);
            t.set(docRef, {
                invoiceId: invoiceId,
                vendorName: vendorName,
                amount: numAmount,
                subtotalAmount: Number(data.subtotalAmount) || 0,
                taxAmount: Number(data.taxAmount) || 0,
                currency: data.currency || 'EUR',
                dateCreated: data.dateCreated || '',
                invoiceYear: ym.year,
                invoiceMonth: ym.month,
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
                rawText: (data._rawText || '').slice(0, 50000) || null,  // Full text for Repairman re-extraction
                // A6: SHA-256 of source PDF for idempotency (indexed)
                contentHash: data.contentHash || null,
                // A2: docIndex/docCount — present only on multi-invoice PDFs
                docIndex: data.docIndex ?? null,
                docCount: data.docCount ?? null,
                // A1: per-field Azure confidence scores and aggregates
                confidenceScores: data.confidenceScores || null,
                minFieldConfidence: typeof data.minFieldConfidence === 'number' ? data.minFieldConfidence : null,
                avgFieldConfidence: typeof data.avgFieldConfidence === 'number' ? data.avgFieldConfidence : null,
                lowConfidenceFields: Array.isArray(data.lowConfidenceFields) ? data.lowConfidenceFields : [],
                // A5: extraction quality from Azure (high | medium | low)
                extractionQuality: data.extractionQuality || null,
                // C1: anomaly detection score and reasons
                anomalyScore: typeof data.anomalyScore === 'number' ? data.anomalyScore : null,
                anomalyReasons: Array.isArray(data.anomalyReasons) ? data.anomalyReasons : [],
                anomalyZScore: typeof data.anomalyZScore === 'number' ? data.anomalyZScore : null,
                // B1: VIES validation outcome (valid | invalid | unverified)
                viesStatus: data.viesStatus || null,
                viesValidation: data.viesValidation || null
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
                firestoreDocId: docRef.id,
                invoiceId: invoiceId,
                vendorName: vendorName,
                amount: numAmount,
                currency: data.currency || 'EUR',
                dateCreated: data.dateCreated || '',
                invoiceYear: ym.year,
                invoiceMonth: ym.month,
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

        debug(`[Firestore] ${dataArray.length} invoice(s) successfully written via Transaction!`);

        // --- DROPBOX UPLOAD (M1: saga pattern with state tracking) ---
        // Two services that can't share an atomic transaction (Dropbox is
        // external). Saga pattern instead:
        //   1. Mark invoice `dropboxStatus: 'uploading'` so retry sweepers
        //      know an attempt is in flight
        //   2. Upload to Dropbox (with retry on transient errors)
        //   3. On success: update invoice with dropboxPath +
        //      `dropboxStatus: 'committed'`
        //   4. On failure after retries: update invoice with
        //      `dropboxStatus: 'failed', dropboxError: <msg>` so a future
        //      sweep can re-attempt without the human knowing
        //
        // The orphan_cleanup script (M3) catches the inverse failure
        // (Dropbox file with no Firestore invoice) — that pair completes
        // the saga.
        const dropboxEnabled = process.env.DROPBOX_REFRESH_TOKEN || process.env.DROPBOX_ACCESS_TOKEN;
        if (dropboxEnabled) {
            for (const payload of webhooksToSend) {
                const docId = payload.firestoreDocId || payload.invoiceId;
                const invRef = db.collection('invoices').doc(docId);

                try {
                    if (!payload.fileUrl) continue;

                    // Phase 1: write intent
                    await invRef.update({
                        dropboxStatus: 'uploading',
                        dropboxAttemptedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });

                    const cId = payload.companyId;
                    const companyDoc = cId ? await db.collection('companies').doc(cId).get() : null;
                    const companyData = companyDoc?.exists ? companyDoc.data() : null;
                    const companyName = companyData?.name || '';

                    // M2: pass full company doc so dropboxConfig field overrides
                    // the legacy hardcoded IDEACOM/GLOBAL TECHNICS heuristic.
                    const folderPath = buildDropboxFolderPath(companyName, payload.invoiceYear, payload.invoiceMonth, companyData);

                    // Phase 2: download PDF + upload to Dropbox with retry
                    const { default: fetch } = await import('node-fetch');
                    const pdfRes = await fetch(payload.fileUrl);
                    if (!pdfRes.ok) throw new Error(`Failed to download PDF: ${pdfRes.status}`);
                    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

                    // Filename: "26114_Anesta.pdf" (invoiceId + vendor short name)
                    const vendorShort = (payload.vendorName || '').replace(/\s*(OÜ|AS|LLC|SIA|UAB|GmbH|Ltd)\s*/gi, '').trim() || 'Unknown';
                    const dropboxFileName = `${payload.invoiceId}_${vendorShort}`;

                    // Retry up to 3 times with exponential backoff for
                    // transient Dropbox errors (rate limit, network blip)
                    let dropboxPath = null;
                    let lastErr = null;
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        try {
                            dropboxPath = await uploadInvoiceToPDF(dropboxFileName, pdfBuffer, folderPath);
                            break;
                        } catch (e) {
                            lastErr = e;
                            const transient = /429|5\d\d|ECONN|timeout|network/i.test(e.message || '');
                            if (!transient || attempt === 3) throw e;
                            await new Promise(res => setTimeout(res, 1000 * Math.pow(2, attempt - 1)));
                            console.warn(`[Dropbox] ⏳ Retry ${attempt + 1}/3 for ${payload.invoiceId} after: ${e.message}`);
                        }
                    }
                    console.log(`[Dropbox] ✅ Uploaded ${payload.invoiceId} → ${dropboxPath}`);

                    // Phase 3: commit dropboxPath + status
                    await invRef.update({
                        dropboxPath,
                        dropboxStatus: 'committed',
                        dropboxCommittedAt: admin.firestore.FieldValue.serverTimestamp(),
                        dropboxError: admin.firestore.FieldValue.delete(),
                    });
                } catch (dbxErr) {
                    console.error(`[Dropbox] ❌ Upload failed for ${payload.invoiceId}:`, dbxErr.message);
                    // Phase 4 (failure): mark for future retry
                    try {
                        await invRef.update({
                            dropboxStatus: 'failed',
                            dropboxError: dbxErr.message.slice(0, 500),
                            dropboxFailedAt: admin.firestore.FieldValue.serverTimestamp(),
                        });
                    } catch (updateErr) {
                        console.warn(`[Dropbox] Failed to flag retry state: ${updateErr.message}`);
                    }
                }
            }
        } else {
            if (webhooksToSend.length > 0) {
                console.warn(`[Dropbox] ⚠️  Dropbox credentials not set — skipping upload for ${webhooksToSend.length} invoice(s)`);
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
    // A6: Compute idempotency hash once on the raw buffer, attach to every
    // invoice produced by this file. Multi-doc PDFs share the same hash —
    // dedup in writeToFirestore must take (contentHash, docIndex) together.
    const contentHash = computeContentHash(content);

    // Step 1: Scout — DocAI + multilingual regex
    const tempParsed = await processInvoiceWithDocAI(content, mimeType, null, customRules || '');
    if (!tempParsed || tempParsed.length === 0) return null;

    // Stamp hash on every extracted invoice for downstream dedup.
    for (const inv of tempParsed) {
        inv.contentHash = contentHash;
    }

    // Step 2: Teacher — validate and fill from Charter + examples
    try {
        const teacherResult = await validateAndTeach(tempParsed[0], companyId, tempParsed[0]._rawText || '');
        tempParsed[0] = teacherResult.invoice;

        if (teacherResult.corrections && teacherResult.corrections.length > 0) {
            debug(`[Teacher] Corrections applied: ${teacherResult.corrections.join('; ')}`);
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
                            debug(`[Claude QC] Currency ${sub > 0 ? '→' : 'set to'} ${fixes.currency}, amount=${fixes.amount}`);
                        } else {
                            if (fixes.amount !== undefined) tempParsed[0].amount = fixes.amount;
                            if (fixes.subtotalAmount !== undefined) tempParsed[0].subtotalAmount = fixes.subtotalAmount;
                            if (fixes.taxAmount !== undefined) tempParsed[0].taxAmount = fixes.taxAmount;
                        }
                        if (fixes.isPaid) tempParsed[0].status = 'Paid';
                        debug(`[Claude QC] Applied fixes in Scout pipeline`);
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
