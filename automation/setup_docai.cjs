const { google } = require('googleapis');
const credentials = require('./google-credentials.json');

async function enableDocumentAI() {
    console.log("Checking Service Account permissions...");
    try {
        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });

        const authClient = await auth.getClient();
        const serviceUsage = google.serviceusage({ version: 'v1', auth: authClient });
        
        const projectId = credentials.project_id;
        const serviceName = `projects/${projectId}/services/documentai.googleapis.com`;

        console.log(`Attempting to enable ${serviceName}...`);
        
        const response = await serviceUsage.services.enable({
            name: serviceName
        });
        
        console.log("API Enablement Response:", response.data);
        console.log("SUCCESS: The service account has permission to enable APIs.");
    } catch (e) {
        console.error("ERROR: Failed to enable API.");
        console.error(e.message);
    }
}

enableDocumentAI();
