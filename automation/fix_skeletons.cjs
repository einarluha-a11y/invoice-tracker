#!/usr/bin/env node
/**
 * fix_skeletons.cjs — Alias for repairman_agent.cjs --mode skeletons
 *
 * Kept for backward compatibility. All logic now lives in repairman_agent.cjs.
 *
 * Usage (unchanged):
 *   node fix_skeletons.cjs                          # dry-run
 *   node fix_skeletons.cjs --fix                    # delete skeleton records
 *   node fix_skeletons.cjs --company <id> --fix     # filter by company
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
