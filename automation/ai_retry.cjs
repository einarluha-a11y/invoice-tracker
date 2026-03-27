/**
 * Intercepts Anthropic API calls and applies Exponential Backoff for 429 and 529 errors.
 * Ensures the invoice parser doesn't fatally crash during temporary LLM capacity outages.
 */
async function createWithRetry(anthropicClient, payload, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            return await anthropicClient.messages.create(payload);
        } catch (error) {
            const isRateLimit = error.status === 429 || (error.message && error.message.toLowerCase().includes('rate limit'));
            const isOverloaded = error.status === 529 || error.status >= 500 || (error.message && error.message.toLowerCase().includes('overloaded'));
            
            if ((isRateLimit || isOverloaded) && i < retries - 1) {
                const waitTime = Math.pow(2, i) * 2000; // 2s, 4s, 8s
                console.warn(`[AI Resilience] Anthropic API rejected (HTTP ${error.status}). Initiating exponential backoff: T-${waitTime/1000}s until retry ${i+1}/${retries}...`);
                await new Promise(res => setTimeout(res, waitTime));
            } else {
                console.error(`[AI Resilience] Fatal AI collapse after ${retries} attempts. Exception propogated.`);
                throw error;
            }
        }
    }
}

module.exports = { createWithRetry };
