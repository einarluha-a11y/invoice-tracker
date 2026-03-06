const admin = require('firebase-admin');
const fs = require('fs');
const serviceAccount = JSON.parse(fs.readFileSync('./google-credentials.json', 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function run() {
  try {
    const [buckets] = await admin.storage().bucket().storage.getBuckets();
    console.log("Buckets found:");
    buckets.forEach(b => console.log(b.name));
  } catch (e) {
    console.error("Error:", e.message);
  }
}
run();
