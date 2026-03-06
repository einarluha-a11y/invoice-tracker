const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Helper to add 30 days handling both DD-MM-YYYY and YYYY-MM-DD
function add30Days(dateStr) {
    if (!dateStr) return dateStr;
    const parts = dateStr.includes('-') ? dateStr.split('-') : dateStr.split('.');
    if (parts.length !== 3) return dateStr;

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

    // Ignore invalid dates for now instead of generating 1919
    if (year < 2000) year += 2000;

    const d = new Date(year, month, day);
    d.setDate(d.getDate() + 30);

    const newDay = String(d.getDate()).padStart(2, '0');
    const newMonth = String(d.getMonth() + 1).padStart(2, '0');
    const newYear = d.getFullYear();

    return `${newDay}-${newMonth}-${newYear}`;
}

async function fixDates() {
    const invoicesRef = db.collection('invoices');
    const snapshot = await invoicesRef.get();

    let count = 0;
    const batch = db.batch();

    snapshot.docs.forEach(doc => {
        const data = doc.data();
        const vendor = (data.vendorName || '').toLowerCase();

        if (vendor.includes('pronto') || vendor.includes('inovatus')) {
            const currentCreated = data.dateCreated;
            const currentDue = data.dueDate;

            if (currentCreated) {
                const targetDue = add30Days(currentCreated);
                if (currentDue !== targetDue) {
                    console.log(`Fixing ${doc.id} | Vendor: ${data.vendorName} | Created: ${currentCreated} | Old Due: ${currentDue} -> New Due: ${targetDue}`);
                    batch.update(doc.ref, { dueDate: targetDue });
                    count++;
                }
            }
        }
    });

    if (count > 0) {
        await batch.commit();
        console.log(`Successfully updated ${count} invoices.`);
    } else {
        console.log('No invoices needed fixing.');
    }

    process.exit(0);
}

fixDates();
