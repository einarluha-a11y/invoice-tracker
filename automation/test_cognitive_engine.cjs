require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { processInvoiceWithDocAI } = require('./document_ai_service.cjs');
const { intellectualSupervisorGate } = require('./supreme_supervisor.cjs');

async function testCognitiveEngine() {
    console.log(`[Test Bench] 🔮 Igniting Pure Claude Extraction Engine...`);
    
    // Look for a test PDF in the automation folder (Ideacom or Pronto)
    const testFiles = fs.readdirSync(__dirname).filter(f => f.endsWith('.pdf'));
    if (testFiles.length === 0) {
        console.log(`[Test Bench] ⚠️ No local PDFs found in automation/ to test. Please provide one or check IMAP.`);
        return;
    }
    
    // Pick the first PDF
    const targetFile = testFiles[0];
    const filePath = path.join(__dirname, targetFile);
    console.log(`[Test Bench] 📄 Loading File: ${targetFile}`);
    
    const fileBuffer = fs.readFileSync(filePath);

    try {
        console.log(`[Test Bench] 🧠 Passing ${targetFile} to Claude 3.5 Sonnet for Visual Comprehension...`);
        const extractedPayloads = await processInvoiceWithDocAI(fileBuffer, 'application/pdf');
        
        console.log(`\n[Test Bench] 📊 Raw Claude Extracted JSON:`);
        console.log(JSON.stringify(extractedPayloads, null, 2));

        if (extractedPayloads && extractedPayloads.length > 0) {
            console.log(`\n[Test Bench] 🦅 Interrogating the Supreme Supervisor Gate...`);
            const gateResult = await intellectualSupervisorGate(extractedPayloads[0]);
            
            console.log(`[Gate Result] Passed: ${gateResult.passed}`);
            console.log(`[Gate Reason] ${gateResult.reason}`);
            
            if (gateResult.passed) {
                console.log(`\n[Test Bench] 🟢 EXACT MATCH: Pure AI successfully comprehended the document and passed the logic gate!`);
            } else {
                console.log(`\n[Test Bench] 🛑 GATE BLOCKED: Supervisor found a logic anomaly!`);
            }
        }

    } catch (err) {
        console.error(`[Test Bench] Exception:`, err);
    }
}

testCognitiveEngine();
