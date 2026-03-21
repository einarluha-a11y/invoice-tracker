const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const fs = require('fs');
const path = require('path');

// Initialize with our existing service account
const client = new DocumentProcessorServiceClient({
    keyFilename: path.join(__dirname, 'google-credentials.json'),
    apiEndpoint: 'eu-documentai.googleapis.com'
});

const projectId = 'invoice-tracker-xyz';
const location = 'eu';
const processorId = '8087614a36686ed4'; // User provided ID
const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;

async function testDocumentAI() {
    try {
        console.log(`Connecting to Processor: ${name}`);
        
        // Choose a test file from the directory
        const filePath = path.join(__dirname, 'test_result_group.pdf');
        console.log(`Loading file: ${filePath}`);
        
        if (!fs.existsSync(filePath)) {
            console.error("Test file does not exist.");
            process.exit(1);
        }

        const imageFile = fs.readFileSync(filePath);
        const encodedImage = Buffer.from(imageFile).toString('base64');

        const request = {
            name,
            rawDocument: {
                content: encodedImage,
                mimeType: 'application/pdf',
            },
        };

        console.log("Sending document to Google Cloud AI for structured extraction...");
        const [result] = await client.processDocument(request);
        const { document } = result;

        console.log("\n--- INVOICE PARSING RESULTS ---");
        
        let subtotal = 'N/A';
        let tax = 'N/A';
        let total = 'N/A';
        let currency = 'N/A';
        let supplier = 'N/A';
        let lineItemsCount = 0;

        // The parser returns key fields in the 'entities' array
        if (document.entities) {
            for (const entity of document.entities) {
                if (entity.type === 'supplier_name') supplier = entity.mentionText;
                if (entity.type === 'total_amount') total = entity.mentionText;
                if (entity.type === 'total_tax_amount') tax = entity.mentionText;
                if (entity.type === 'net_amount' || entity.type === 'subtotal') subtotal = entity.mentionText;
                if (entity.type === 'currency') currency = entity.mentionText;
                if (entity.type === 'line_item') lineItemsCount++;
            }
        }

        console.log(`Supplier: ${supplier}`);
        console.log(`Subtotal (без налога): ${subtotal}`);
        console.log(`Tax/VAT (налог): ${tax}`);
        console.log(`Total (с налогом): ${total} ${currency}`);
        console.log(`Found Line Items (позиций в таблице): ${lineItemsCount}`);
        
        console.log("\n-- Line Item Breakdown --");
        if (document.entities) {
            document.entities.filter(e => e.type === 'line_item').forEach((item, index) => {
                let description = '';
                let amount = '';
                if (item.properties) {
                    const descProp = item.properties.find(p => p.type === 'line_item/description');
                    const amtProp = item.properties.find(p => p.type === 'line_item/amount');
                    if (descProp) description = descProp.mentionText.replace(/\n/g, ' ').substring(0, 50);
                    if (amtProp) amount = amtProp.mentionText;
                }
                console.log(`[${index + 1}] ${description.padEnd(50)} | ${amount}`);
            });
        }

        console.log("\nSuccess!");
        process.exit(0);

    } catch (error) {
        console.error("Error during Document AI processing:");
        console.error(error.message);
        
        if (error.message.includes('not found') || error.message.includes('NOT_FOUND')) {
            console.log("Attempting fallback to 'us' region...");
            // Restart script with US configuration (left as exercise for the fallback run)
            process.exit(2);
        }
        process.exit(1);
    }
}

testDocumentAI();
