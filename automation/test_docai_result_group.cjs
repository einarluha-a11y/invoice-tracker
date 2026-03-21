const fs = require('fs');
const path = require('path');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');

async function testResultGroup() {
    console.log('[Test] Loading Result Group PDF...');
    try {
        const filePath = path.join(__dirname, 'result_group.pdf');
        
        if (!fs.existsSync(filePath)) {
            console.error(`[Test Error] File not found at ${filePath}. Assuming it might be named test_result_group.pdf...`);
            return;
        }

        const fileBuffer = fs.readFileSync(filePath);
        console.log(`[Test] File loaded (${fileBuffer.length} bytes). Sending to Document AI...`);
        
        const parsedDataArray = await processInvoiceWithDocAI(fileBuffer, 'application/pdf');
        
        console.log('\n====================================');
        console.log('🤖 Document AI Extraction Results:');
        console.log('====================================\n');
        console.log(JSON.stringify(parsedDataArray, null, 2));

        console.log('\n[Test Complete] Review the dateCreated, taxAmount, and lineItems above.');

    } catch (err) {
        console.error('[Test Failed]', err);
    }
}

testResultGroup();
