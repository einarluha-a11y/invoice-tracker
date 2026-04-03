import { collection, onSnapshot, doc, getDoc, getDocs, deleteDoc, updateDoc, setDoc, query, orderBy, where, limit, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Invoice, InvoiceStatus } from './mockInvoices';

export interface RawInvoiceRow {
    id: string;
    vendor: string;
    amount: string;
    currency: string;
    datecreated: string;
    duedate: string;
    status: string;
}

// Убрана жесткая привязка к .env
// Конфигурация теперь управляется через src/config.ts

export const parseStatus = (rawStatus: string, parsedDueDate?: string): InvoiceStatus => {
    const normalized = rawStatus.toLowerCase().trim();
    // Error/NEEDS_REVIEW → Pending (Error status removed from system)
    if (normalized === 'needs_review' || rawStatus === 'NEEDS_REVIEW' || normalized === 'needs action' || normalized === 'error') return 'Pending';
    if (normalized === 'paid' || normalized === 'оплачен' || normalized === 'makstud') return 'Paid';
    if (normalized === 'overdue' || normalized === 'просрочен' || normalized.includes('maksetähtaja') || normalized.includes('ületanud')) return 'Overdue';
    if (normalized === 'ootel' || normalized === 'pending') return 'Pending';

    // Auto-infer status based on due date if not explicitly paid or overdue
    if (parsedDueDate) {
        const due = new Date(parsedDueDate);
        const today = new Date();

        // Reset time components to accurately compare only the dates
        due.setHours(0, 0, 0, 0);
        today.setHours(0, 0, 0, 0);

        if (today.getTime() > due.getTime()) {
            return 'Overdue';
        }
    }

    return 'Pending';
};

export const parseAmount = (rawAmount: string): number => {
    if (!rawAmount) return 0;
    // FIX Bug 4: handle European number formats correctly (e.g. 1.200,50 → 1200.5)
    let s = rawAmount.replace(/[^\d.,-]/g, '').trim();
    if (s.includes(',') && s.includes('.')) {
        // Both separators present: determine which is the decimal separator
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
            // European: 1.200,50 → remove dots, replace comma with dot
            s = s.replace(/\./g, '').replace(',', '.');
        } else {
            // US: 1,200.50 → remove commas
            s = s.replace(/,/g, '');
        }
    } else if (s.includes(',')) {
        // Only comma present: treat as decimal separator (e.g. 831,20 → 831.20)
        s = s.replace(',', '.');
    }
    const amount = parseFloat(s);
    return isNaN(amount) ? 0 : amount;
};

export const parseDate = (rawDate: string): string => {
    if (!rawDate) return new Date().toISOString();

    const cleanDate = rawDate.trim();

    // Check for DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, DD-MM-YY, DD.MM.YY
    const euroPattern = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/;
    const match = cleanDate.match(euroPattern);

    if (match) {
        const [, day, month, yearMatch] = match;
        const paddedMonth = month.padStart(2, '0');
        const paddedDay = day.padStart(2, '0');

        // If year is 2 digits, assume 2000s
        const year = yearMatch.length === 2 ? `20${yearMatch}` : yearMatch;

        return `${year}-${paddedMonth}-${paddedDay}`; // ISO format YYYY-MM-DD
    }

    // Check for YYYY-MM-DD or other formats that JS can parse natively
    const fallbackDate = new Date(cleanDate);
    if (!isNaN(fallbackDate.getTime())) {
        return cleanDate;
    }

    return new Date().toISOString();
};

export const subscribeToInvoices = (
    companyId: string,
    limitCount: number,
    onData: (invoices: Invoice[]) => void,
    onError: (error: Error) => void
) => {
    if (!db) {
        console.warn("Firestore not initialized.");
        onData([]);
        return () => { };
    }

    // Apply native server-side indexing to prevent O(N) client RAM crashes!
    const q = query(
        collection(db, 'invoices'), 
        where('companyId', '==', companyId),
        orderBy('dateCreated', 'desc'),
        limit(limitCount)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedData: Invoice[] = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const parsedDueDate = parseDate(data.dueDate);
            fetchedData.push({
                id: docSnap.id,
                invoiceId: data.invoiceId,
                vendor: data.vendorName || data.vendor || 'Unknown Vendor',
                description: data.description || data.invoiceId || '',
                amount: parseAmount(data.amount?.toString() || '0'),
                currency: data.currency || 'EUR',
                dateCreated: parseDate(data.dateCreated),
                dueDate: parsedDueDate,
                status: parseStatus(data.status || '', parsedDueDate),
                fileUrl: data.fileUrl || data.originalFileUrl || undefined,
                subtotalAmount: data.subtotalAmount,
                taxAmount: data.taxAmount,
                lineItems: data.lineItems,
                validationWarnings: data.validationWarnings,
                supplierRegistration: data.supplierRegistration,
                supplierVat: data.supplierVat,
                receiverName: data.receiverName,
                receiverVat: data.receiverVat,
                paymentTerms: data.paymentTerms,
                viesValidation: data.viesValidation,
                enrichmentSource: data.enrichmentSource || data.recoverySource || undefined,
                originalForeignCurrency: data.originalForeignCurrency || undefined,
                originalForeignAmount: data.originalForeignAmount || undefined,
            });
        });

        onData(fetchedData);
    }, (error) => {
        console.error("Firestore subscription error:", error);
        onError(error);
    });

    return unsubscribe;
};

export const deleteInvoice = async (invoiceId: string): Promise<void> => {
    if (!db) throw new Error("Database not initialized");
    await deleteDoc(doc(db, 'invoices', invoiceId));
};

export const updateInvoice = async (invoiceId: string, data: Partial<Invoice>): Promise<void> => {
    if (!db) throw new Error("Database not initialized");

    const invoiceRef = doc(db, 'invoices', invoiceId);
    let originalVendorName = '';
    let companyId = '';

    // Fetch original invoice to compare vendor name for AI Auto-Learning
    if (data.vendor !== undefined) {
        const snap = await getDoc(invoiceRef);
        if (snap.exists()) {
            originalVendorName = snap.data().vendorName || snap.data().vendor || '';
            companyId = snap.data().companyId || '';
        }
    }

    // Map frontend Invoice fields back to DB fields
    const updateData: any = {};
    if (data.vendor !== undefined) updateData.vendorName = data.vendor;
    if (data.invoiceId !== undefined) updateData.invoiceId = data.invoiceId;
    if (data.amount !== undefined) updateData.amount = data.amount;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.dateCreated !== undefined) updateData.dateCreated = data.dateCreated;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.supplierVat !== undefined) updateData.supplierVat = data.supplierVat;
    if (data.supplierRegistration !== undefined) updateData.supplierRegistration = data.supplierRegistration;
    if (data.subtotalAmount !== undefined) updateData.subtotalAmount = data.subtotalAmount;
    if (data.taxAmount !== undefined) updateData.taxAmount = data.taxAmount;
    if (data.description !== undefined) updateData.description = data.description;

    // Mark as manually edited — Repairman will not overwrite these fields
    updateData.manuallyEdited = true;

    await updateDoc(invoiceRef, updateData);

    // AI Self-Healing Loop: Log the manual correction as a global rule
    if (data.vendor && originalVendorName && data.vendor !== originalVendorName) {
        const cleanOld = originalVendorName.trim();
        const cleanNew = data.vendor.trim();

        if (cleanOld.length > 2 && cleanNew.length > 2 && cleanOld.toLowerCase() !== cleanNew.toLowerCase()) {
            const globalRulesRef = doc(db!, 'config', 'global_ai_rules');
            const globalSnap = await getDoc(globalRulesRef);
            const currentRules = globalSnap.exists() ? (globalSnap.data().customAiRules || '') : '';
            const newRule = `If you see "${cleanOld}", the correct official name is "${cleanNew}".`;

            if (!currentRules.includes(newRule)) {
                await setDoc(globalRulesRef, {
                    customAiRules: currentRules ? `${currentRules}\n${newRule}` : newRule,
                    updatedAt: serverTimestamp(),
                    updatedBy: 'auto-learning'
                }, { merge: true });
                console.log(`[AI-Self-Healing] Taught AI: ${newRule}`);
            }
        }
    }

    // ── Teacher Agent: save corrected invoice as ground-truth example ──────────
    // Every manual save via the pencil icon is treated as a verified correction.
    // This feeds the few-shot learning system in teacher_agent.cjs.
    // Runs unconditionally — even if no fields were changed — so the Teacher
    // always has an up-to-date record of the human-verified correct state.
    try {
        const snap = await getDoc(invoiceRef);
        if (snap.exists()) {
            const d = snap.data();
            const vendorName = (d.vendorName || d.vendor || '').trim();
            if (vendorName) {
                // Key: vendor name + actual invoice number (not Firestore doc ID)
                const invoiceNumber = d.invoiceId || invoiceId;
                const safeKey = `${vendorName}_${invoiceNumber}`
                    .replace(/[^a-zA-Z0-9_\-]/g, '_')
                    .slice(0, 80);

                // Derive vendor matching patterns for Teacher Agent lookup
                const vendorWords = vendorName.toLowerCase().split(/\s+/)
                    .filter((w: string) => !/(oü|as|uab|sia|llc|gmbh|inc|bv)/.test(w));
                const vendorPatterns: string[] = [vendorName.toLowerCase()];
                if (vendorWords[0]) vendorPatterns.push(vendorWords[0]);
                if (vendorWords.length > 1) vendorPatterns.push(vendorWords.slice(0, 2).join(' '));

                const exampleRef = doc(db!, 'invoice_examples', safeKey);
                await setDoc(exampleRef, {
                    vendorName,
                    vendorPatterns: [...new Set(vendorPatterns)],
                    groundTruth: {
                        invoiceId:            invoiceNumber,
                        vendorName:           vendorName,
                        supplierRegistration: d.supplierRegistration ?? null,
                        supplierVat:          d.supplierVat          ?? null,
                        amount:               d.amount               ?? null,
                        subtotalAmount:       d.subtotalAmount       ?? null,
                        taxAmount:            d.taxAmount            ?? null,
                        currency:             d.currency             ?? null,
                        dateCreated:          d.dateCreated          ?? null,
                        dueDate:              d.dueDate              ?? null,
                        status:               d.status               ?? null,
                        description:          d.description          ?? null,
                    },
                    // Raw file references — used by Repairman and Teacher agents
                    fileUrl:    d.fileUrl    || d.downloadUrl || null,
                    stagingId:  d.stagingId  || null,  // → raw_documents → storageUrl (original PDF)
                    companyId:  d.companyId  || null,
                    updatedAt:  serverTimestamp(),
                    createdAt:  serverTimestamp(),
                }, { merge: true });

                console.log(`[Teacher Agent] ✅ Ground-truth saved for: ${vendorName} (${safeKey})`);

                // ── Vendor Profile: track correction stats + auto-generate Charter rules ──
                // After 2+ corrections with the same value → write rule to Charter automatically
                const AUTO_RULE_THRESHOLD = 2;
                const profileKey = vendorName.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 60);
                const profileRef = doc(db!, 'vendor_profiles', profileKey);

                try {
                    const profileSnap = await getDoc(profileRef);
                    const profile = profileSnap.exists() ? profileSnap.data() : {};
                    const corrections: Record<string, any> = profile.corrections || {};
                    const vatNumbers: string[] = profile.vatNumbers || [];

                    // Track VAT numbers for this vendor
                    const currentVat = d.supplierVat || '';
                    if (currentVat && !vatNumbers.includes(currentVat)) {
                        vatNumbers.push(currentVat);
                    }

                    // Track field corrections: {fieldName: {value: "EUR", count: 3}}
                    const TRACKABLE_FIELDS: Record<string, string> = {
                        currency:             d.currency ?? '',
                        description:          d.description ?? '',
                        supplierVat:          d.supplierVat ?? '',
                        supplierRegistration: d.supplierRegistration ?? '',
                    };

                    for (const [field, value] of Object.entries(TRACKABLE_FIELDS)) {
                        if (!value) continue;
                        const prev = corrections[field];
                        if (prev && prev.value === value) {
                            corrections[field] = { value, count: (prev.count || 1) + 1 };
                        } else {
                            corrections[field] = { value, count: 1 };
                        }
                    }

                    // Calculate dueDate rule from dateCreated → dueDate pattern
                    if (d.dateCreated && d.dueDate && d.dateCreated !== d.dueDate) {
                        try {
                            const created = new Date(d.dateCreated);
                            const due = new Date(d.dueDate);
                            const diffDays = Math.round((due.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
                            if (diffDays > 0 && diffDays <= 120) {
                                const prev = corrections['dueDateRule'];
                                const ruleVal = `net-${diffDays}`;
                                if (prev && prev.value === ruleVal) {
                                    corrections['dueDateRule'] = { value: ruleVal, count: (prev.count || 1) + 1 };
                                } else {
                                    corrections['dueDateRule'] = { value: ruleVal, count: 1 };
                                }
                            }
                        } catch { /* date parse error — skip */ }
                    }

                    // Save updated profile
                    await setDoc(profileRef, {
                        vendorName,
                        vatNumbers,
                        corrections,
                        totalEdits:  (profile.totalEdits || 0) + 1,
                        updatedAt:   serverTimestamp(),
                    }, { merge: true });

                    // ── Auto-generate global Charter rules when threshold reached ──
                    {
                        const globalRulesRef = doc(db!, 'config', 'global_ai_rules');
                        const globalSnap = await getDoc(globalRulesRef);
                        const currentRules = globalSnap.exists() ? (globalSnap.data().customAiRules || '') : '';
                        const newRules: string[] = [];

                        for (const [field, stats] of Object.entries(corrections) as [string, any][]) {
                            if (stats.count < AUTO_RULE_THRESHOLD) continue;

                            let rule = '';
                            if (field === 'currency') {
                                rule = `Vendor "${vendorName}": currency = "${stats.value}"`;
                            } else if (field === 'description') {
                                rule = `Vendor "${vendorName}": description = "${stats.value}"`;
                            } else if (field === 'dueDateRule') {
                                rule = `Vendor "${vendorName}": ${stats.value}`;
                            }

                            if (rule && !currentRules.includes(rule)) {
                                newRules.push(rule);
                            }
                        }

                        if (newRules.length > 0) {
                            const updatedRules = currentRules
                                ? `${currentRules}\n${newRules.join('\n')}`
                                : newRules.join('\n');
                            await setDoc(globalRulesRef, {
                                customAiRules: updatedRules,
                                updatedAt: serverTimestamp(),
                                updatedBy: 'auto-learning'
                            }, { merge: true });
                            console.log(`[Teacher Agent] Auto-generated ${newRules.length} global Charter rule(s): ${newRules.join(' | ')}`);
                        }
                    }
                } catch (profileErr) {
                    console.warn(`[Teacher Agent] ⚠️  Vendor profile update failed: ${profileErr}`);
                }

                // ── Global Learning: extract universal patterns from corrections ──
                // These patterns apply to ALL invoices, not just this vendor.
                // Example: "VAT prefix EE → currency EUR" helps every Estonian vendor.
                try {
                    const vatPrefix = (d.supplierVat || '').replace(/[^A-Z]/gi, '').slice(0, 2).toUpperCase();
                    const globalRulesRef = collection(db!, 'teacher_global_rules');

                    // Pattern 1: VAT country → currency mapping
                    if (vatPrefix.length === 2 && d.currency) {
                        const ruleId = `vat_${vatPrefix}_currency`;
                        const ruleRef = doc(db!, 'teacher_global_rules', ruleId);
                        const ruleSnap = await getDoc(ruleRef);
                        const existing = ruleSnap.exists() ? ruleSnap.data() : null;

                        if (existing && existing.value === d.currency) {
                            await setDoc(ruleRef, { count: (existing.count || 1) + 1, updatedAt: serverTimestamp() }, { merge: true });
                        } else if (!existing) {
                            await setDoc(ruleRef, {
                                type: 'vat_country_currency',
                                condition: vatPrefix,
                                field: 'currency',
                                value: d.currency,
                                count: 1,
                                createdAt: serverTimestamp(),
                                updatedAt: serverTimestamp(),
                            });
                        }
                    }

                    // Pattern 2: dueDate calculation pattern (net-N days) — universal
                    if (d.dateCreated && d.dueDate && d.dateCreated !== d.dueDate) {
                        try {
                            const created = new Date(d.dateCreated);
                            const due = new Date(d.dueDate);
                            const diffDays = Math.round((due.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
                            // Track common payment terms globally
                            if ([7, 10, 14, 15, 21, 30, 45, 60, 90].includes(diffDays)) {
                                const ruleId = `payment_term_net${diffDays}`;
                                const ruleRef = doc(db!, 'teacher_global_rules', ruleId);
                                const ruleSnap = await getDoc(ruleRef);
                                const existing = ruleSnap.exists() ? ruleSnap.data() : null;
                                await setDoc(ruleRef, {
                                    type: 'common_payment_term',
                                    field: 'dueDate',
                                    value: `net-${diffDays}`,
                                    count: (existing?.count || 0) + 1,
                                    updatedAt: serverTimestamp(),
                                }, { merge: true });
                            }
                        } catch { /* date parse error */ }
                    }

                    // Pattern 3: amount vs subtotal relationship (tax rate pattern)
                    if (d.amount && d.subtotalAmount && d.taxAmount !== undefined) {
                        const taxRate = d.subtotalAmount > 0
                            ? Math.round((d.taxAmount / d.subtotalAmount) * 100)
                            : 0;
                        if ([0, 5, 9, 10, 13, 20, 21, 22, 25].includes(taxRate)) {
                            const ruleId = vatPrefix.length === 2
                                ? `vat_${vatPrefix}_taxrate`
                                : `taxrate_${taxRate}`;
                            const ruleRef = doc(db!, 'teacher_global_rules', ruleId);
                            const ruleSnap = await getDoc(ruleRef);
                            const existing = ruleSnap.exists() ? ruleSnap.data() : null;

                            if (existing && existing.value === taxRate) {
                                await setDoc(ruleRef, { count: (existing.count || 1) + 1, updatedAt: serverTimestamp() }, { merge: true });
                            } else if (!existing) {
                                await setDoc(ruleRef, {
                                    type: 'vat_country_taxrate',
                                    condition: vatPrefix || 'unknown',
                                    field: 'taxRate',
                                    value: taxRate,
                                    count: 1,
                                    createdAt: serverTimestamp(),
                                    updatedAt: serverTimestamp(),
                                });
                            }
                        }
                    }
                } catch (globalErr) {
                    console.warn(`[Teacher Agent] ⚠️  Global pattern update failed: ${globalErr}`);
                }
            }
        }
    } catch (teachErr) {
        // Non-fatal: don't block the save if Teacher Agent fails
        console.warn(`[Teacher Agent] ⚠️  Could not save example: ${teachErr}`);
    }

    // ── Post-save reconciliation: check bank_transactions for payment ──────
    // After manual edit, check if this invoice was already paid.
    try {
        const freshSnap = await getDoc(invoiceRef);
        if (freshSnap.exists()) {
            const d = freshSnap.data();
            if (d.companyId && (d.status !== 'Paid' || (d.currency && d.currency !== 'EUR'))) {
                const invoiceAmount = parseFloat(d.amount) || 0;
                const invoiceNum = (d.invoiceId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const vendorWords = (d.vendorName || '').toLowerCase().split(/[^a-zöäüõ0-9]+/).filter((w: string) => w.length >= 3);
                const invoiceDate = d.dateCreated || '';

                const txSnap = await getDocs(query(
                    collection(db!, 'bank_transactions'),
                    where('companyId', '==', d.companyId)
                ));

                const isForeignCurrency = d.currency && d.currency !== 'EUR';

                for (const txDoc of txSnap.docs) {
                    const tx = txDoc.data();
                    const txAmount = parseFloat(tx.amount) || 0;
                    if (invoiceDate && tx.date && tx.date < invoiceDate) continue;

                    const txVendor = (tx.counterparty || '').toLowerCase();
                    const txRef = (tx.reference || '').toLowerCase().replace(/[^a-z0-9]/g, '');

                    const refMatch = invoiceNum.length > 3 && (txRef.includes(invoiceNum) || invoiceNum.includes(txRef));
                    const vendorMatch = vendorWords.length > 0 && vendorWords.some((w: string) => txVendor.includes(w));
                    const isEttemaks = (tx.reference || '').toLowerCase().includes('ettemaks');

                    // Amount check: skip if amounts don't match (unless foreign currency)
                    if (!isForeignCurrency && Math.abs(txAmount - invoiceAmount) > 0.50) continue;

                    if (vendorMatch && !refMatch && txRef.length > 3 && !isEttemaks) continue;
                    if (vendorMatch || refMatch) {
                        // FX conversion: replace amount with EUR from bank statement
                        const updatePayload: any = { status: 'Paid', previousStatus: d.status };
                        if (isForeignCurrency) {
                            updatePayload.originalForeignAmount = invoiceAmount;
                            updatePayload.originalForeignCurrency = d.currency;
                            updatePayload.amount = txAmount;
                            updatePayload.currency = 'EUR';
                            console.log(`[Post-Save Reconciliation] FX: ${d.invoiceId} ${invoiceAmount} ${d.currency} → ${txAmount} EUR`);
                        }
                        await updateDoc(invoiceRef, updatePayload);
                        console.log(`[Post-Save Reconciliation] Invoice ${d.invoiceId} → Paid (matched bank tx €${txAmount})`);
                        break;
                    }
                }
            }
        }
    } catch (reconErr) {
        console.warn(`[Post-Save Reconciliation] ⚠️  Failed: ${reconErr}`);
    }
};
