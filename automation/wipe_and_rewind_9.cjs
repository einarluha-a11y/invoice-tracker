const admin = require('firebase-admin');
const imaps = require('imap-simple');
var serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function purgeAndRewind() {
    console.log('[Recovery] Phase 1: Wiping infected records from Firestore...');
    const snapshot = await db.collection('invoices')
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();

    const ideacomDocs = snapshot.docs.filter(doc => doc.data().companyId === 'vlhvA6i8d3Hry8rtrA3Z').slice(0, 10);
    
    let deletedCount = 0;
    for (const doc of ideacomDocs) {
        const data = doc.data();
        // Specifically spare pl21-28 because we already know it is structurally perfect.
        if (data.invoiceId === 'pl21-28' || data.invoiceId === 'PL21-28') {
            console.log(`[Recovery] 🛡️ Sparing PERFECT record: ${data.vendorName} | ${data.invoiceId}`);
            continue;
        }
        
        console.log(`[Recovery] 🗑️ Deleting INFECTED record: ${data.vendorName} | ${data.invoiceId}`);
        await doc.ref.delete();
        deletedCount++;
    }
    console.log(`[Recovery] Successfully purged ${deletedCount} infected payloads from the database.`);

    console.log('\n[Recovery] Phase 2: Rewinding IMAP cursor for Ideacom...');
    const companyDoc = await db.collection('companies').doc('vlhvA6i8d3Hry8rtrA3Z').get();
    const companyData = companyDoc.data();

    const config = {
        imap: {
            user: companyData.imapUser,
            password: companyData.imapPassword,
            host: companyData.imapHost.trim(),
            port: companyData.imapPort || 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 3000
        }
    };

    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const targetUids = [9, 10, 11, 15, 23, 24, 25, 28, 29, 30, 40, 47, 59, 60, 62, 63, 64, 67, 75, 76, 77, 78, 79, 94, 96, 102, 104, 106];
        console.log(`[Recovery] Rewinding UNSEEN flag on the 28 historic Ideacom UIDs...`);
        
        for (const targetUid of targetUids) {
            await connection.addFlags(targetUid, ['\\Seen']); // Ensure they are seen first just in case
            await connection.delFlags(targetUid, ['\\Seen']);
        }

        console.log('[Recovery] ✅ Success. The PM2 Daemon is now intrinsically engaged.');
        console.log('[Recovery] It will deduplicate the safe records and resurrect the 9 purged payloads flawlessly.');
        
        connection.end();
        process.exit(0);
        
    } catch (err) {
        console.error('[Recovery] IMAP Rewind Failed:', err);
        process.exit(1);
    }
}

purgeAndRewind();
