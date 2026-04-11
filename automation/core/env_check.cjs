/**
 * Startup environment check (Minor).
 *
 * Daemons (imap_daemon, api_server, watchdog) should fail-fast on
 * missing config rather than crash hours later inside a request handler
 * or burn an Anthropic call to discover the API key isn't set.
 *
 * Each component declares its required env vars and optional ones with
 * defaults. checkEnv(...) returns:
 *   { ok: true,  missing: [], present: [...] }   on success
 *   { ok: false, missing: [...], present: [...] } on failure
 *
 * Caller decides whether to log + exit (production) or just warn (dev).
 *
 * Usage in a daemon entrypoint:
 *   const { checkEnv, REQUIRED_FOR } = require('./core/env_check.cjs');
 *   const r = checkEnv(REQUIRED_FOR.imap_daemon);
 *   if (!r.ok) {
 *       console.error('[env] Missing required:', r.missing.join(', '));
 *       process.exit(1);
 *   }
 */

'use strict';

// Required env vars per daemon. The values are descriptions for error
// messages, not validation regex.
const REQUIRED_FOR = {
    imap_daemon: [
        ['FIREBASE_SERVICE_ACCOUNT', 'Firebase admin SDK credentials JSON'],
        ['ANTHROPIC_API_KEY',        'Claude Haiku API key for fallback extraction'],
        ['AZURE_DOC_INTEL_ENDPOINT', 'Azure Document Intelligence endpoint URL'],
        ['AZURE_DOC_INTEL_KEY',      'Azure Document Intelligence API key'],
    ],
    api_server: [
        ['FIREBASE_SERVICE_ACCOUNT', 'Firebase admin SDK credentials JSON'],
        ['ANTHROPIC_API_KEY',        'Claude Haiku API key for /api/chat'],
    ],
    repairman: [
        ['FIREBASE_SERVICE_ACCOUNT', 'Firebase admin SDK credentials JSON'],
        ['AZURE_DOC_INTEL_ENDPOINT', 'Azure Document Intelligence endpoint URL'],
        ['AZURE_DOC_INTEL_KEY',      'Azure Document Intelligence API key'],
    ],
    bank_processor: [
        ['FIREBASE_SERVICE_ACCOUNT', 'Firebase admin SDK credentials JSON'],
    ],
    // Frontend build env vars (consumed by Vite at build time, not at runtime,
    // but we list them here for the Railway deploy startup probe)
    frontend_build: [
        ['VITE_FIREBASE_API_KEY',         'Firebase web API key'],
        ['VITE_FIREBASE_AUTH_DOMAIN',     'Firebase auth domain'],
        ['VITE_FIREBASE_PROJECT_ID',      'Firebase project id'],
        ['VITE_FIREBASE_STORAGE_BUCKET',  'Firebase storage bucket'],
        ['VITE_FIREBASE_MESSAGING_SENDER_ID', 'Firebase messaging sender id'],
        ['VITE_FIREBASE_APP_ID',          'Firebase web app id'],
    ],
};

/**
 * Check that the named env vars are all set to non-empty strings.
 *
 * @param {Array<[string, string]>} required
 * @returns {{ ok: boolean, missing: string[], present: string[] }}
 */
function checkEnv(required) {
    const missing = [];
    const present = [];
    for (const [name, _description] of required) {
        const v = process.env[name];
        if (!v || String(v).trim() === '') {
            missing.push(name);
        } else {
            present.push(name);
        }
    }
    return { ok: missing.length === 0, missing, present };
}

/**
 * Check + log + exit on failure (production daemon entrypoint helper).
 *
 * @param {string} component name like 'imap_daemon' (must be a key in REQUIRED_FOR)
 * @param {object} [opts]
 * @param {boolean} [opts.exitOnFail=true] — call process.exit(1) if any required missing
 */
function ensureEnv(component, opts = {}) {
    const { exitOnFail = true } = opts;
    const required = REQUIRED_FOR[component];
    if (!required) {
        console.warn(`[env] Unknown component: ${component} — no required vars declared`);
        return { ok: true, missing: [], present: [] };
    }
    const result = checkEnv(required);
    if (!result.ok) {
        console.error(`[env] ❌ ${component}: missing required env vars: ${result.missing.join(', ')}`);
        for (const [name, desc] of required) {
            if (result.missing.includes(name)) {
                console.error(`[env]    ${name}  — ${desc}`);
            }
        }
        if (exitOnFail) {
            console.error('[env] Exiting (use --no-env-check to override).');
            process.exit(1);
        }
    } else {
        console.log(`[env] ✅ ${component}: all ${result.present.length} required vars present`);
    }
    return result;
}

module.exports = {
    checkEnv,
    ensureEnv,
    REQUIRED_FOR,
};
