const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function fixCustomDueDates() {
    try {
        const snapshot = await db.collection('invoices').get();
        let changed = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const vendor = (data.vendorName || '').toLowerCase();

            if (vendor.includes('pronto') || vendor.includes('inovatus')) {
                if (data.dateCreated) {
                    let dMatch = null;
                    let year, month, day;

                    // YYYY-MM-DD
                    if (data.dateCreated.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        [year, month, day] = data.dateCreated.split('-');
                    }
                    // DD-MM-YYYY
                    else if (data.dateCreated.match(/^\d{2}-\d{2}-\d{4}$/)) {
                        [day, month, year] = data.dateCreated.split('-');
                    }
                    // DD.MM.YYYY
                    else if (data.dateCreated.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
                        [day, month, year] = data.dateCreated.split('.');
                    }

                    if (year && month && day) {
                        const dateObj = new Date(`${year}-${month}-${day}`);
                        dateObj.setDate(dateObj.getDate() + 30);

                        // Reconstruct to DD-MM-YYYY because that's PRONTO's format in this DB
                        const dd = String(dateObj.getDate()).padStart(2, '0');
                        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                        const yyyy = dateObj.getFullYear();

                        // We will keep standardizing to the format the invoice already uses just to be safe,
                        // or better yet, standardize EVERYTHING to YYYY-MM-DD for easier sorting.
                        // Let's standardize PRONTO to YYYY-MM-DD so sorting works properly in the dashboard.
                        const newDueDateIso = `${yyyy}-${mm}-${dd}`;
                        const newCreatedIso = `${year}-${month}-${day}`;

                        let needsUpdate = false;
                        let updatePayload = {};

                        // Fix creation date format if it was DD-MM-YYYY
                        if (data.dateCreated !== newCreatedIso) {
                            updatePayload.dateCreated = newCreatedIso;
                            needsUpdate = true;
                        }

                        if (data.dueDate !== newDueDateIso) {
                            updatePayload.dueDate = newDueDateIso;
                            needsUpdate = true;
                        }

                        if (needsUpdate) {
                            const dNum = new Date(newDueDateIso).getTime();
                            let newStatus = data.status;
                            if (data.status === 'Pending' || data.status === 'Overdue' || data.status === 'Unpaid') {
                                if (dNum < Date.now()) newStatus = 'Overdue';
                                else newStatus = 'Pending';
                            }
                            updatePayload.status = newStatus;

                            console.log(`[Updating] ${data.vendorName} (Inv: ${data.invoiceId}): Created ${data.dateCreated}->${newCreatedIso} | Due ${data.dueDate}->${newDueDateIso}`);
                            await doc.ref.update(updatePayload);
                            changed++;
                        }
                    }
                }
            }
        }

        console.log(`Successfully updated ${changed} historic invoices with the new 30-day rule.`);
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

fixCustomDueDates();
