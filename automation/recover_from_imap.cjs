#!/usr/bin/env node
/**
 * recover_from_imap.cjs — Alias for repairman_agent.cjs --mode skeletons
 *
 * Kept for backward compatibility. All logic now lives in repairman_agent.cjs.
 *
 * Usage (unchanged):
 *   node recover_from_imap.cjs                         # dry-run
 *   node recover_from_imap.cjs --fix                   # execute recovery
 *   node recover_from_imap.cjs --company <id> --fix    # one company only
 *   node recover_from_imap.cjs --fix --skip-imap       # only delete, no IMAP reset
 */
const { execFileSync } = require('child_process');
const path = require('path');

const extraArgs = process.argv.slice(2);
const args = [path.join(__dirname, 'repairman_agent.cjs'), '--mode', 'skeletons', ...extraArgs];

try {
    execFileSync(process.execPath, args, { stdio: 'inherit' });
} catch (err) {
    process.exit(err.status || 1);
}
