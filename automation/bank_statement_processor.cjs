require('dotenv').config({ path: __dirname + '/.env' });
const { parse } = require('csv-parse/sync');

// Firebase Admin Initialization (Shared Core)
const { admin, db } = require('./core/firebase.cjs');
// Bank transaction dedup
const { saveBankTransaction } = require('./core/bank_dedup.cjs');
// Strict reconciliation rules (shared with repairman_agent, api.ts)
const { matchReference, vendorOverlap } = require('./core/reconcile_rules.cjs');
// Number parsing — single source of truth for European/US decimal formats
const { cleanNum, getVendorAliases: _getVendorAliases } = require('./core/utils.cjs');
// Merit Aktiva sync — sends payments automatically
const { syncPaymentToMerit } = require('./merit_sync.cjs');

// Wrap shared getVendorAliases to auto-inject db
const getVendorAliases = (companyId) => _getVendorAliases(db, companyId);

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

        // Prepayment (Ettemaksuteatis/Pro-forma) detection:
        // Bank reference contains "ettemaks" — payment was for a prepayment invoice,
        // but the real Arve has a different number. Allow wider amount tolerance (±0.50)
        // and match by vendor name only.
        const isEttemaksPayment = (reference || '').toLowerCase().includes('ettemaks');

        const assessCandidate = (doc, isPaid) => {
            const data = doc.data();
            const invoiceAmount = cleanNum(data.amount);

            // STRICT RULE: reference match (exact OR strong substring) + vendor word overlap.
            // This replaces the liberal "amount + vendorName contains" scoring that caused
            // false Paid matches (PRONTO pl21-25 → pl21-27 + pl21-28, NUNNER → FFC cross-vendor).
            const refMatch = matchReference(data.invoiceId, reference);
            const vendorOk = vendorOverlap(data.vendorName, bankDesc);

            // Ettemaksuteatis / FX fallback: allow vendor-only match with tighter amount tolerance
            // ONLY for prepayment references, where invoiceId naturally differs from tx ref.
            const allowVendorOnly = isEttemaksPayment;

            // Amount check: exact ±0.50 tolerance (covers bank fees) OR foreign amount match
            const isAmountMatch = Math.abs(invoiceAmount - paidAmount) <= 0.50 ||
                                  (foreignAmount !== null && Math.abs(invoiceAmount - foreignAmount) <= 0.50);

            if (!isAmountMatch) return;

            // Must have BOTH reference match AND vendor overlap (strict mode).
            // Exception: prepayment (ettemaks) — vendor-only match allowed.
            const qualifies = (refMatch && vendorOk) || (allowVendorOnly && vendorOk);
            if (!qualifies) {
                if (!refMatch && vendorOk) {
                    console.log(`[Reconciliation] SKIP vendor-only match: ${data.invoiceId} (${data.vendorName}) — ref "${reference}" doesn't match invoiceId "${data.invoiceId}"`);
                }
                return;
            }

            let totalScore = 0;
            if (refMatch === 'exact') totalScore += 150;
            else if (refMatch === 'strong') totalScore += 75;
            if (vendorOk) totalScore += 25;
            // Extreme priority bias: Unpaid identical bills ALWAYS beat Paid identical bills
            if (!isPaid) totalScore += 500;

            candidates.push({ doc, isPaid, totalScore });
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
                const originalAmount = cleanNum(matchedDoc.data().amount) || 1;
                if (foreignAmount !== null && Math.abs(originalAmount - foreignAmount) <= 0.05 && Math.abs(originalAmount - paidAmount) > 0.05) {
                    const fxRatio = paidAmount / originalAmount;
                    console.log(`[Reconciliation] 💱 FX OVERWRITE: Priority Winner matched foreign bank amount. Adjusting payload to ${paidAmount} EUR (Ratio: ${fxRatio.toFixed(3)})`);

                    // Replace amount with EUR, keep sub/tax in original currency
                    let payoutData = { amount: paidAmount, currency: 'EUR', status: 'Paid' };
                    payoutData.originalForeignAmount = originalAmount;
                    payoutData.originalForeignCurrency = matchedDoc.data().currency || foreignCurrency || 'UNKNOWN';

                    await db.runTransaction(async (t) => {
                        const freshDoc = await t.get(matchedDoc.ref);
                        if (!freshDoc.exists || freshDoc.data().status === 'Paid') return;
                        t.update(matchedDoc.ref, payoutData);
                    });
                    // Merit payment sync
                    try { await syncPaymentToMerit(matchedDoc.data(), { amount: paidAmount, reference: reference }, matchedDoc.id); } catch(e) { console.warn('[Merit] Payment sync (FX):', e.message); }
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
                    // Merit payment sync
                    try { await syncPaymentToMerit(matchedDoc.data(), { amount: paidAmount, reference: reference }, matchedDoc.id); } catch(e) { console.warn('[Merit] Payment sync:', e.message); }
                }
            }
        }

        // 4. Cross-Currency Fallback: Exact Vendor + Exact Date (Amount Differs safely)
        if (!matchedDoc && paymentDateStr && description) {
            const pDate = new Date(paymentDateStr).toISOString().split('T')[0];

            for (const doc of pendingDocs) {
                const data = doc.data();
                // STRICT: require vendor word overlap via central rule (stopword-aware)
                const isNameMatch = vendorOverlap(data.vendorName, bankDesc);

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

                    // Allow ±14 days for card payments (processing delay)
                    const daysDiff = dbDateIso && pDate ? Math.abs((new Date(pDate) - new Date(dbDateIso)) / 86400000) : 999;
                    if (daysDiff <= 14) {
                        matchedDoc = doc;
                        isCrossCurrencyMatch = true;
                        const originalAmount = cleanNum(doc.data().amount) || 1;
                        const fxRatio = paidAmount / originalAmount;

                        console.log(`[Reconciliation] 💱 FX OVERWRITE by Date: ${data.vendorName} on ${pDate}. Adjusting from ${data.amount} ${data.currency} to ${paidAmount} EUR.`);

                        // Replace amount with EUR from bank, keep sub/tax in original currency
                        let crossCurrencyPayload = { amount: paidAmount, currency: 'EUR', status: 'Paid' };
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
                    // Wider tolerance for prepayment pairs (bank fees may differ)
                    if (Math.abs(pData.amount - matchedAmount) <= 0.50) {
                        const pWords = pVendor.split(/[^a-z0-9]/).filter(w => w.length >= 3);
                        const mWords = matchedVendor.split(/[^a-z0-9]/).filter(w => w.length >= 3);
                        const isVendorTwin = pWords.some(w => matchedVendor.includes(w)) || mWords.some(w => pVendor.includes(w));

                        if (isVendorTwin) {
                            // Prepayment/Arve pair: delete the Ettemaksuteatis, keep the Arve as Paid
                            if (isPrepayment(matchedId) || isPrepayment(pData.invoiceId)) {
                                const ettemaksDoc = isPrepayment(pData.invoiceId) ? doc : matchedDoc;
                                const arveDoc = isPrepayment(pData.invoiceId) ? matchedDoc : doc;
                                console.log(`[Reconciliation-ProFormaSwap] Deleting prepayment ${ettemaksDoc.data().invoiceId}, keeping Arve ${arveDoc.data().invoiceId} as Paid.`);
                                await ettemaksDoc.ref.delete();
                                if (arveDoc.id !== matchedDoc.id) {
                                    // Arve is the pending twin — mark it Paid too
                                    await db.runTransaction(async (t) => {
                                        const freshDoc = await t.get(arveDoc.ref);
                                        if (freshDoc.exists && freshDoc.data().status !== 'Paid') {
                                            t.update(arveDoc.ref, { status: 'Paid' });
                                        }
                                    });
                                }
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
                        t.update(docRef, { amount: cleanNum(newAmount.toFixed(2)), status: newStatus });
                    }
                });
                console.log(`  -> Partial payment. Remaining: €${newAmount.toFixed(2)}. Status: ${newStatus}`);
            }
        } else {
            console.log(`[Reconciliation] No pending invoice match for payment €${paidAmount} (Ref: ${reference}, Desc: ${description})`);
        }

        // ── Save transaction to bank_transactions archive (with dedup) ──
        try {
            await saveBankTransaction(db, {
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
            // Detect sign BEFORE cleanNum strips minus (cleanNum preserves minus but safer to check raw)
            const isNegative = String(amountStr).trim().startsWith('-');
            let amount = cleanNum(amountStr);
            if (isNegative) amount = -Math.abs(amount);
            if (!amount || amount >= 0) continue; // Only process outgoing (negative)

            // Calculate exact target invoice amount vs total bank drain
            const rawExtractedAmount = Math.abs(amount);

            // Extract the transactional Fee if present (e.g., "0.20")
            let feeStr = row['Fee'] || row['Bank Fee'] || row['Комиссия'] || row['Teenustasu'] || '0';
            const bankFee = Math.abs(cleanNum(feeStr));

            let invoiceTargetAmount = rawExtractedAmount;
            let totalBankDrain = rawExtractedAmount;

            // If the CSV provides "Total amount" (99.35) and "Amount" (99.15), invoiceTargetAmount is 99.15
            const explicitTargetStr = row['Amount'] || '';
            const explicitTarget = Math.abs(cleanNum(explicitTargetStr));

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
            const foreignAmountNum = cleanNum(origAmountStr);
            const foreignAmount = foreignAmountNum ? Math.abs(foreignAmountNum) : null;
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
 * Uses Claude Haiku to extract outgoing transactions from bank statement text.
 */
async function parseBankStatementWithAI(rawText) {
    if (!rawText || rawText.trim().length < 50) {
        console.warn('[Bank AI] Raw text too short — cannot parse.');
        return null;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
        require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        console.warn('[Bank AI] No ANTHROPIC_API_KEY — cannot parse PDF bank statement.');
        return null;
    }

    try {
        const Anthropic = require('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        // Split long text into chunks if needed (Haiku context is small)
        const snippet = rawText.slice(0, 8000);

        const resp = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 4000,
            messages: [{
                role: 'user',
                content: `Extract ALL outgoing payment transactions from this bank statement.
Only outgoing payments (money leaving the account). Skip incoming, fees, interest, and internal transfers.

Return ONLY a valid JSON array:
[{"date": "YYYY-MM-DD", "description": "recipient/vendor name", "amount": 123.45, "reference": "invoice ref if visible"}]

Rules:
- amount: always POSITIVE number (even though it's outgoing)
- date: format YYYY-MM-DD
- description: the counterparty/recipient name, cleaned (no "To:", no bank codes)
- reference: invoice number from payment description, or "" if not found
- Skip zero-amount rows, bank fees, currency exchanges, internal transfers

Bank statement text:
${snippet}`
            }],
        });

        const text = resp.content[0]?.text || '';
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) {
            console.warn('[Bank AI] Claude returned no array.');
            return null;
        }

        const transactions = JSON.parse(match[0]);
        console.log(`[Bank AI] 🤖 Claude extracted ${transactions.length} outgoing transaction(s) from PDF statement.`);
        return transactions;
    } catch (err) {
        console.error(`[Bank AI] Claude extraction failed: ${err.message}`);
        return null;
    }
}

module.exports = { reconcilePayment, processBankStatement, parseBankStatementWithAI };
