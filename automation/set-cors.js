const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const bucket = admin.storage().bucket('invoice-tracker-xyz.firebasestorage.app');

bucket.setCorsConfiguration([
    {
        maxAgeSeconds: 3600,
        method: ['GET', 'OPTIONS'],
        origin: ['*'],
        responseHeader: ['Origin', 'Content-Type', 'Accept', 'Authorization', 'Content-Length', 'User-Agent', 'x-goog-resumable'],
    },
]).then(() => {
    console.log('CORS updated successfully on Firebase Storage bucket');
    process.exit(0);
}).catch(e => {
    console.error('Error updating CORS:', e);
    process.exit(1);
});
