const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function fixIdeacomFiles() {
    // 1. Get the newly uploaded file URLs
    const pronto = await db.collection('invoices').doc('4y2r0ukzhLw5iT9dgFbl').get();
    const cit = await db.collection('invoices').doc('TcVceyVlEFwfNa15jex1').get();

    // 2. Put them into the active March invoices
    // March Pronto ID:
    const marchProntoId = 'tGabWY18qXmn7PBXkMKi'; // Found via get_ic_missing earlier, PRONTO Sp. z o. o.
    const marchCitadeleId = 'Ihpn48MPNZp5qI6ouNwD'; // Found via get_ic_missing earlier, SIA CITADELE

    try {
        console.log("Updating Pronto...");
        if(pronto.data().fileUrl) {
            await db.collection('invoices').doc(marchProntoId).update({ fileUrl: pronto.data().fileUrl });
            console.log("Pronto OK", pronto.data().fileUrl);
        }
        
        console.log("Updating Citadele...");
        if(cit.data().fileUrl) {
            await db.collection('invoices').doc(marchCitadeleId).update({ fileUrl: cit.data().fileUrl });
            console.log("Citadele OK", cit.data().fileUrl);
        }
        
        process.exit(0);
    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}

fixIdeacomFiles();
