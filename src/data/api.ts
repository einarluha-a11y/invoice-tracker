import { collection, onSnapshot, doc, getDoc, deleteDoc, updateDoc, setDoc, query, orderBy, where, limit, serverTimestamp } from 'firebase/firestore';
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
    if (normalized === 'needs_review' || rawStatus === 'NEEDS_REVIEW' || normalized === 'needs action' || normalized === 'error') return 'Error';
    if (normalized === 'paid' || normalized === 'оплачен') return 'Paid';
    if (normalized === 'overdue' || normalized === 'просрочен') return 'Overdue';
    // 'ootel' (Estonian for "waiting") is treated as Pending, not quarantine

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
    if (data.amount !== undefined) updateData.amount = data.amount;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.dateCreated !== undefined) updateData.dateCreated = data.dateCreated;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate;
    if (data.status !== undefined) updateData.status = data.status;

    await updateDoc(invoiceRef, updateData);

    // AI Self-Healing Loop: Log the manual correction as a rule
    if (companyId && data.vendor && originalVendorName && data.vendor !== originalVendorName) {
        const cleanOld = originalVendorName.trim();
        const cleanNew = data.vendor.trim();
        
        // Ensure changes are meaningful (not just uppercase/lowercase toggles that are 1 character)
        if (cleanOld.length > 2 && cleanNew.length > 2 && cleanOld.toLowerCase() !== cleanNew.toLowerCase()) {
            const companyRef = doc(db, 'companies', companyId);
            const compSnap = await getDoc(companyRef);
            if (compSnap.exists()) {
                const currentRules = compSnap.data().customAiRules || '';
                const newRule = `If you see "${cleanOld}", the correct official name is "${cleanNew}".`;
                
                // Check if rule already exists to prevent duplication
                if (!currentRules.includes(newRule)) {
                    await updateDoc(companyRef, {
                        customAiRules: currentRules ? `${currentRules}\n${newRule}` : newRule
                    });
                    console.log(`[AI-Self-Healing] Taught AI: ${newRule}`);
                }
            }
        }
    }

    // ── Teacher Agent: save corrected invoice as ground-truth example ──────────
    // Every manual save via the pencil icon is treated as a verified correction.
    // This feeds the few-shot learning system in document_ai_service.cjs.
    try {
        const snap = await getDoc(invoiceRef);
        if (snap.exists()) {
            const d = snap.data();
            const vendorName = (d.vendorName || d.vendor || '').trim();
            if (vendorName) {
                const safeKey = `${vendorName}_${invoiceId}`
                    .replace(/[^a-zA-Z0-9_\-]/g, '_')
                    .slice(0, 80);

                const exampleRef = doc(db!, 'invoice_examples', safeKey);
                await setDoc(exampleRef, {
                    vendorName: vendorName.toLowerCase(),
                    groundTruth: {
                        invoiceId,
                        vendorName,
                        amount:      d.amount      ?? null,
                        currency:    d.currency    ?? null,
                        dateCreated: d.dateCreated ?? null,
                        dueDate:     d.dueDate     ?? null,
                    },
                    fileUrl:   d.fileUrl   || d.downloadUrl || null,
                    companyId: d.companyId || null,
                    updatedAt: serverTimestamp(),
                    createdAt: serverTimestamp(),
                }, { merge: true });

                console.log(`[Teacher Agent] ✅ Ground-truth saved for: ${vendorName} (${safeKey})`);
            }
        }
    } catch (teachErr) {
        // Non-fatal: don't block the save if Teacher Agent fails
        console.warn(`[Teacher Agent] ⚠️  Could not save example: ${teachErr}`);
    }
};
