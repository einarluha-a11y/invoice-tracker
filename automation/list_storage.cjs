const admin = require('firebase-admin');
const fs = require('fs');

const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));
if (!admin.apps.length) admin.initializeApp({ 
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'invoice-tracker-xyz.firebasestorage.app'
});
const bucket = admin.storage().bucket();

async function run() {
    const [files] = await bucket.getFiles({ prefix: 'invoices/vlhvA6i8d3Hry8rtrA3Z/' });
    console.log(`Found ${files.length} files in company folder.`);
    files.sort((a, b) => new Date(b.metadata.timeCreated) - new Date(a.metadata.timeCreated));
    for (const f of files.slice(0, 5)) {
        console.log(`- ${f.name} (Created: ${f.metadata.timeCreated})`);
    }
}
run();
