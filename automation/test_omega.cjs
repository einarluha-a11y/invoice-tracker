const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function reconcilePaymentManual(reference, description, paidAmount, paymentDateStr = null) {
    try {
        const invoicesRef = db.collection('invoices');
        let matchedDoc = null;

        const normalizeString = (str) => String(str || '').toLowerCase().trim();
        const normalizeAlphaNum = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        const snapshot = await invoicesRef.get();
        const pendingDocs = [];
        const paidDocs = [];
        snapshot.forEach(doc => {
            if (doc.data().status === 'Paid') paidDocs.push(doc);
            else pendingDocs.push(doc);
        });

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

        if (bankRefClean) {
            for (const doc of pendingDocs) {
                const data = doc.data();
                const dbId = normalizeAlphaNum(data.invoiceId);
                const dbDigits = String(data.invoiceId || '').replace(/[^0-9]/g, '');
                const refDigits = String(reference || '').replace(/[^0-9]/g, '');

                if (dbId) {
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

        if (matchedDoc) {
            const data = matchedDoc.data();
            console.log(`\nFound target invoice: ID=${data.invoiceId}, Vendor=${data.vendorName}, Amount=${data.amount}`);

            if (Math.abs(data.amount - paidAmount) <= 0.05) {
                await matchedDoc.ref.update({ status: 'Paid' });
                console.log(`-> Marked as Paid!`);
            }
        } else {
            console.log(`No match found.`);
        }
    } catch (err) {
        console.error(err);
    }
    process.exit(0);
}

reconcilePaymentManual('Arve 260200153', 'To Omega Laen AS', 831.20, '2026-02-17');
