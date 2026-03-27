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
        const response = await require('./ai_retry.cjs').createWithRetry(anthropic, {
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

        const VALID = new Set(['INVOICE', 'CMR', 'STATEMENT', 'JUNK']);
        const raw = response.content[0].text.trim().toUpperCase();
        // Extract first recognised keyword if Claude added extra words
        const classification = ['INVOICE', 'CMR', 'STATEMENT', 'JUNK'].find(k => raw.includes(k)) || null;
        if (!classification) {
            console.warn(`[Vision Auditor] ⚠️  Unexpected classification response: "${raw}". Defaulting to JUNK.`);
            return 'JUNK';
        }
        return classification;

    } catch (err) {
        console.error(`[Vision Auditor] Error classifying document:`, err.message);
        // Fail-safe: unknown means UNKNOWN — let the caller decide, not assume INVOICE.
        // Returning null causes the caller (index.js) to log and skip rather than misprocess.
        return null;
    }
}

module.exports = { classifyDocumentWithVision };
