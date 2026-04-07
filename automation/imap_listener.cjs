require('dotenv').config({ path: __dirname + '/.env' });
const { reportError } = require('./error_reporter.cjs');
const { safetyNetSave } = require('./safety_net.cjs');
const imaps = require('imap-simple');
const simpleParser = require('mailparser').simpleParser;
const pdfParse = require('pdf-parse');

// Firebase Admin Initialization (Shared Core)
const { admin, db } = require('./core/firebase.cjs');
// Staging layer
const { stageDocument, markStagingResult } = require('./core/staging.cjs');
// Invoice processing pipeline
const { uploadToStorage, parseInvoiceDataWithAI, writeToFirestore, scoutTeacherPipeline } = require('./invoice_processor.cjs');
// Bank statement processing
const { reconcilePayment, processBankStatement, parseBankStatementWithAI } = require('./bank_statement_processor.cjs');
// Accountant agent
const { auditAndProcessInvoice } = require('./accountant_agent.cjs');
// Teacher for body-text invoices
const { validateAndTeach } = require('./teacher_agent.cjs');

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
            let skipCatchAllUid = false; // Set true when Accountant rejects — allow retry after code fix
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
                const processedAttachments = new Set(); // dedup by filename+size within same email
                for (const attachment of parsedEmail.attachments) {
                    const filename = (attachment.filename || '').toLowerCase();
                    const mime = (attachment.contentType || '').toLowerCase();

                    if (!filename && !mime) continue; // Skip entirely broken inline attachments

                    // Skip duplicate attachments in same email (same file attached + inlined)
                    const attachKey = `${filename}|${attachment.size || attachment.content?.length || 0}`;
                    if (processedAttachments.has(attachKey)) {
                        console.log(`[Email] Skipping duplicate attachment: ${filename} (already processed in this email)`);
                        continue;
                    }
                    processedAttachments.add(attachKey);

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
                                        console.warn(`[Accountant Agent] 🛑 Invoice rejected (record not saved). Will retry on next poll.`);
                                        await markStagingResult(stagingId, { status: 'rejected', error: 'Accountant rejected record' });
                                        skipCatchAllUid = true; // Don't save UID — allow retry after code fix
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
                                    const teacherResult = await validateAndTeach(inv, companyId, inv._rawText || '');
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
            // Exception: if Accountant rejected the invoice, skip — allow retry after code fix.
            if (!skipCatchAllUid) {
                await saveUid('catch_all');
            }
        } // end for each email

        console.log(`[System] IMAP connection closed for ${companyName}.`);
    } catch (error) {
        console.error(`[Email Error] IMAP Failure for ${companyName} (${config.imap.user}):`, error);
        await reportError('IMAP_ERROR', config.imap.user || companyId, error).catch(() => {});
    }
}

async function pollAllCompanyInboxes() {
    console.log('[System] Polling all company inboxes...');
    try {
        // 1. Check default backend .env inbox first (requires IMAP_COMPANY_ID to route invoices)
        if (process.env.IMAP_USER && process.env.IMAP_PASSWORD && process.env.IMAP_HOST && process.env.IMAP_COMPANY_ID) {
            await checkEmailForInvoices({
                user: process.env.IMAP_USER,
                password: process.env.IMAP_PASSWORD,
                host: process.env.IMAP_HOST,
                port: process.env.IMAP_PORT
            }, "Global Backend Default", process.env.IMAP_COMPANY_ID);
        }

        // 2. Load global AI rules once (shared across all companies)
        const { getGlobalAiRules } = require('./core/firebase.cjs');
        const globalRules = await getGlobalAiRules();

        // 3. Query Firestore for company-specific inboxes
        const companiesSnapshot = await db.collection('companies').get();
        for (const doc of companiesSnapshot.docs) {
            const data = doc.data();
            if (data.imapHost && data.imapUser && data.imapPassword) {
                const customConfig = {
                    user:     (data.imapUser    || '').trim(),
                    password: (data.imapPassword || '').trim(),
                    host:     (data.imapHost     || '').trim(),
                    port:     data.imapPort || 993
                };
                await checkEmailForInvoices(customConfig, data.name, doc.id, globalRules);
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

// Overlap-safe IMAP polling daemon
console.log('Automated Invoice Processor Started. Checking every 2 minutes...');
async function pollLoop() {
    while (true) {
        try {
            await pollAllCompanyInboxes();
        } catch (err) {
            console.error('[Poll Loop Error] Critical failure in IMAP daemon:', err.message);
        }
        await new Promise(resolve => setTimeout(resolve, 2 * 60 * 1000));
    }
}

module.exports = { checkEmailForInvoices, pollAllCompanyInboxes, checkAndRunFlagTasks, pollLoop };
