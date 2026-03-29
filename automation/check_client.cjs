const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, query, where, orderBy, limit } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyDummyKeyForLocalTestOnly",
  projectId: "invoice-tracker-xyz"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
    const q = query(collection(db, 'invoices'), where('companyId', '==', 'bP6dc0PMdFtnmS5QTX4N'), limit(3));
    try {
        const snap = await getDocs(q);
        snap.forEach(doc => {
            console.log(doc.id, doc.data().vendorName, "fileUrl:", doc.data().fileUrl);
        });
    } catch(e) { console.log(e); }
    process.exit(0);
}
run();
