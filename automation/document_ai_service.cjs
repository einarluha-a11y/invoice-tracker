const { Anthropic } = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * PURE CLAUDE EXTRACTION ENGINE 
 * Now supports Supervisor Reflection Loops (criticism parameter).
 */
async function processInvoiceWithDocAI(buffer, mimeType = 'application/pdf', supervisorCritique = null) {
    if (supervisorCritique) {
        console.log(`[Cognitive Extractor] 🧠 Receiving orders from Supervisor... Executing deep re-scan for missing data!`);
    } else {
        console.log(`[Cognitive Extractor] 🧠 Routing document natively through Claude 3.5 Sonnet...`);
    }
    
    try {
        const base64Data = buffer.toString('base64');
        const isPdf = mimeType.toLowerCase().includes('pdf');
        let normalizedMime = isPdf ? 'application/pdf' : (mimeType.toLowerCase().includes('png') ? 'image/png' : 'image/jpeg');
        const blockType = isPdf ? "document" : "image";

        let systemPrompt = `You are the Supreme AI Extraction Engine for a European Enterprise.
Your job is to read the attached financial document and extract the core accounting data into a strict JSON format.

CRITICAL DIRECTIVES:
1. INTELLIGENT CURRENCY: Extract the TRUE AMOUNT TO PAY in the international billing currency (EUR/USD). DO NOT extract the local tax conversion equivalent (e.g., if you see "Wartość brutto 3 600 EUR... 15 386 PLN", the amount is 3600!).
2. MANDATORY FIELDS: The Supervisor requires Vendor, Subtotal, Tax, Total, Supplier Reg No, and VAT Reg No. 
3. LANGUAGE & LOCALIZATION HINTS: Be extremely careful with Baltic invoices. "KMKR" = VAT Reg No (supplierVat), "Registrikood" = Supplier Reg No (supplierRegistration), "Käibemaks" = Tax Amount, "Kokku" / "Arve Kokku" = Total Amount, "Maksustatav" = Subtotal.
4. COMPLEX TAX BREAKDOWNS: If there are multiple tax rates or items (e.g., 20% and 0%), look for the master or total "Käibemaks" (Tax) and "Kokku" (Total) at the bottom summary. Do not mistake the row values for the total tax.
5. EXPLICIT NOT_FOUND FLAG: If you search the ENTIRE document and a requested field (like VAT Reg No) physically DOES NOT EXIST on the paper (e.g. it's a non-VAT receipt), you MUST output the exact string "NOT_FOUND_ON_INVOICE" for that field. Do not leave it blank. Provide the string "NOT_FOUND_ON_INVOICE".

Respond ONLY with a JSON array matching this schema:
[
  {
    "invoiceId": "string",
    "vendorName": "string",
    "supplierRegistration": "string or NOT_FOUND_ON_INVOICE",
    "supplierVat": "string or NOT_FOUND_ON_INVOICE",
    "receiverName": "string",
    "receiverVat": "string",
    "amount": number,
    "taxAmount": number,
    "subtotalAmount": number,
    "currency": "EUR/USD/GBP",
    "dateCreated": "YYYY-MM-DD",
    "dueDate": "YYYY-MM-DD",
    "status": "OOTEL",
    "lineItems": [ { "description": "string", "amount": number } ]
  }
]`;

        if (supervisorCritique) {
            systemPrompt += `\n\n🚨 SUPERVISOR CRITIQUE FROM PREVIOUS ATTEMPT:\n${supervisorCritique}\n\nThe Supervisor rejected your last JSON because you missed mandatory fields. You must scan the document again, pixel by pixel, specifically looking for the fields mentioned by the Supervisor. If you still cannot find them, you MUST write "NOT_FOUND_ON_INVOICE".`;
        }

        const response = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2000,
            temperature: 0.1,
            system: "You are the world's most intelligent accounting extraction AI.",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: systemPrompt },
                        {
                            type: blockType,
                            source: {
                                type: "base64",
                                media_type: normalizedMime,
                                data: base64Data
                            }
                        }
                    ]
                }
            ]
        });

        const rawJson = response.content[0].text.trim().replace(/^```json\n|\n```$/g, '');
        const extractedData = JSON.parse(rawJson);
        
        console.log(`[Cognitive Extractor] ✅ Extraction Complete:`);
        console.log(`   -> Vendor: ${extractedData[0].vendorName}`);
        console.log(`   -> Total: ${extractedData[0].amount} | Sub: ${extractedData[0].subtotalAmount} | Tax: ${extractedData[0].taxAmount}`);
        console.log(`   -> RegNo: ${extractedData[0].supplierRegistration} | VAT: ${extractedData[0].supplierVat}`);
        
        return extractedData;

    } catch (error) {
        console.error(`[Cognitive Extractor] 🚨 Local Exception:`, error.message);
        throw error;
    }
}

module.exports = { processInvoiceWithDocAI };
