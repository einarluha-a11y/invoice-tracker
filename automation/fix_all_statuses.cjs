#!/usr/bin/env node
/**
 * fix_all_statuses.cjs — Alias for repairman_agent.cjs --mode statuses
 *
 * Kept for backward compatibility. All logic now lives in repairman_agent.cjs.
 *
 * Usage (unchanged):
 *   node fix_all_statuses.cjs          # dry-run
 *   node fix_all_statuses.cjs --fix    # apply the reset
 */
const { execFileSync } = require('child_process');
const path = require('path');

const extraArgs = process.argv.slice(2);
const args = [path.join(__dirname, 'repairman_agent.cjs'), '--mode', 'statuses', ...extraArgs];

try {
    execFileSync(process.execPath, args, { stdio: 'inherit' });
} catch (err) {
    process.exit(err.status || 1);
}
