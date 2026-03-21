const { Anthropic } = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * VISION AUDITOR
 * Examines a PDF or Image buffer using Claude 3.5 Sonnet's Vision capabilities.
 * Returns EXACTLY ONE classification string: INVOICE, CMR, STATEMENT, or JUNK.
 */
async function classifyDocumentWithVision(buffer, mimeType = 'application/pdf') {
    try {
        const base64Data = buffer.toString('base64');
        const isPdf = mimeType.includes('pdf');
        
        let normalizedMime = isPdf ? 'application/pdf' : 
                            (mimeType.includes('png') ? 'image/png' : 'image/jpeg');

        const blockType = isPdf ? "document" : "image";

        const promptText = `
Analyze this document visually. 
Is it a CMR (International Consignment Note / Waybill), an Account Statement, or a true Financial Invoice?
If it is a CMR, it usually has the letters CMR in the top right, and lots of boxes for Sender/Consignee/Carrier.
If it is an email signature, a tiny logo, or an irrelevant picture, classify it as JUNK.
Reply with EXACTLY ONE WORD from this list:
INVOICE
CMR
STATEMENT
JUNK
`;
        const response = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 50,
            temperature: 0,
            system: "You are a strict accounting document classification AI. Never explain your reasoning, just output the ONE WORD classification.",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: promptText },
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

        const classification = response.content[0].text.trim().toUpperCase();
        return classification;

    } catch (err) {
        console.error(`[Vision Auditor] Error classifying document:`, err.message);
        // Fail-safe: if the API fails, assume JUNK if it's an image, INVOICE if it's a PDF
        return (mimeType.includes('pdf')) ? 'INVOICE' : 'JUNK'; 
    }
}

module.exports = { classifyDocumentWithVision };
