/**
 * Claude API rate limiter — token bucket, default 50 req/min (M4).
 *
 * Anthropic's tier-1 rate limit is 50 requests/minute. Without a client-side
 * limiter we hit 429s during bursts (IMAP poll → 5 invoices arriving in one
 * batch → Scout + Teacher + Repairman all calling Claude back-to-back).
 *
 * The bucket holds CAPACITY tokens. Each acquire() consumes 1 token.
 * Tokens refill at REFILL_PER_MIN per minute (continuously). When the
 * bucket is empty, acquire() awaits until the next token is available.
 *
 * Single shared instance — all callers across the process share the same
 * 50/min budget. Survives module re-imports because of Node's module cache.
 *
 * Usage:
 *   const { withClaudeBudget } = require('./core/claude_rate_limit.cjs');
 *   const result = await withClaudeBudget(() => client.messages.create({...}));
 *
 * Environment overrides:
 *   CLAUDE_RATE_LIMIT_RPM   — requests per minute (default 50)
 *   CLAUDE_RATE_LIMIT_BURST — bucket capacity (default = rpm)
 */

'use strict';

const RPM = parseInt(process.env.CLAUDE_RATE_LIMIT_RPM || '50', 10);
const BURST = parseInt(process.env.CLAUDE_RATE_LIMIT_BURST || String(RPM), 10);
const REFILL_INTERVAL_MS = 60_000 / RPM; // ms between refills

let tokens = BURST;
let lastRefill = Date.now();
const waitQueue = []; // FIFO of resolvers waiting for a token

function refill() {
    const now = Date.now();
    const elapsed = now - lastRefill;
    if (elapsed <= 0) return;
    const generated = Math.floor(elapsed / REFILL_INTERVAL_MS);
    if (generated > 0) {
        tokens = Math.min(BURST, tokens + generated);
        lastRefill += generated * REFILL_INTERVAL_MS;
        // Wake waiters
        while (tokens > 0 && waitQueue.length > 0) {
            const resolve = waitQueue.shift();
            tokens--;
            resolve();
        }
    }
}

// Background timer keeps refill flowing even when no one calls acquire()
// (so waiters in the queue eventually wake up).
const _refillTimer = setInterval(refill, Math.max(50, REFILL_INTERVAL_MS));
if (_refillTimer.unref) _refillTimer.unref(); // don't keep process alive

/**
 * Acquire one token. If the bucket has tokens, returns immediately.
 * If empty, awaits until a token becomes available.
 */
function acquire() {
    refill();
    if (tokens > 0) {
        tokens--;
        return Promise.resolve();
    }
    return new Promise(resolve => waitQueue.push(resolve));
}

/**
 * Wraps a Claude API call with budget enforcement. The caller passes a
 * thunk so we can await the bucket BEFORE the actual API request fires.
 *
 * @example
 *   const resp = await withClaudeBudget(() => client.messages.create({...}));
 */
async function withClaudeBudget(thunk) {
    await acquire();
    return thunk();
}

/**
 * Diagnostic — current bucket state. Useful for tests and /health probes.
 */
function getBudgetState() {
    refill();
    return {
        tokens,
        capacity: BURST,
        rpm: RPM,
        waiters: waitQueue.length,
    };
}

module.exports = {
    acquire,
    withClaudeBudget,
    getBudgetState,
    RPM,
    BURST,
};
