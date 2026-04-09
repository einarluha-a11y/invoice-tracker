#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           WATCHDOG — Independent Process Supervisor           ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Monitors all PM2 processes every 2 minutes.                  ║
 * ║  Restarts hung/crashed processes automatically.               ║
 * ║  Reports errors to pipeline via SOLUTION.md.                  ║
 * ║  PM2 watches watchdog — double safety net.                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..');
const CHECK_INTERVAL = 120000; // 2 min
const HANG_TIMEOUT = 600000;  // 10 min — if pipeline-monitor shows same log for 10 min, it's hung
const PERPLEXITY_TIMEOUT = 600000; // 10 min — if DEPLOY_STATUS: OK sits without Perplexity response
const STATE_FILE = '/tmp/.watchdog_state';
const ERROR_COOLDOWN = 600000; // 10 min — don't spam bug reports

const WATCHED_PROCESSES = ['invoice-api', 'invoice-imap', 'pipeline-monitor', 'pipeline-webhook', 'tunnel-manager'];

function log(msg) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function readState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
    catch { return { lastPipelineLog: '', lastPipelineCheck: 0, lastBugReport: 0 }; }
}

function writeState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

function pm2Restart(name) {
    try {
        execSync(`pm2 restart ${name}`, { timeout: 15000, stdio: 'pipe' });
        log(`🔄 Restarted ${name}`);
        return true;
    } catch (err) {
        log(`❌ Failed to restart ${name}: ${err.message.slice(0, 100)}`);
        return false;
    }
}

function getPm2Info() {
    try {
        const json = execSync('pm2 jlist', { encoding: 'utf-8', timeout: 10000 });
        return JSON.parse(json);
    } catch { return []; }
}

function getLastLog(name, lines = 3) {
    try {
        return execSync(`pm2 logs ${name} --lines ${lines} --nostream --out 2>/dev/null`, {
            encoding: 'utf-8', timeout: 5000
        }).trim();
    } catch { return ''; }
}

function getErrorLog(name, lines = 10) {
    try {
        return execSync(`pm2 logs ${name} --lines ${lines} --nostream --err 2>/dev/null`, {
            encoding: 'utf-8', timeout: 5000
        }).trim();
    } catch { return ''; }
}

function gitCommitAndPush(file, message) {
    try {
        execSync(`cd ${PROJECT} && git add ${file} && git commit -m "${message}" && git pull --rebase origin main && git push origin main`, {
            timeout: 30000, stdio: 'pipe'
        });
        return true;
    } catch {
        try {
            execSync(`cd ${PROJECT} && git pull --rebase origin main && git add ${file} && git commit -m "${message}" && git push origin main`, {
                timeout: 30000, stdio: 'pipe'
            });
            return true;
        } catch { return false; }
    }
}

function submitBugReport(errors) {
    const errorSummary = errors.map(e => `- **${e.process}**: ${e.error}`).join('\n');
    const bugReport = `# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: Watchdog автоматический баг-репорт

## ОШИБКИ

${errorSummary}

## ЗАДАНИЕ

Проанализируй ошибки. Найди причину в коде, исправь, node --check, коммит, пуш.

DEPLOY_STATUS: pending
`;
    const solutionPath = path.join(PROJECT, '_agents/pipeline/SOLUTION.md');
    fs.writeFileSync(solutionPath, bugReport);
    return gitCommitAndPush('_agents/pipeline/SOLUTION.md', 'watchdog: auto bug report');
}

// ── Main check ───────────────────────────────────────────────────────────────
function check() {
    const procs = getPm2Info();
    const state = readState();
    const now = Date.now();
    const actions = [];
    const errors = [];

    for (const name of WATCHED_PROCESSES) {
        const proc = procs.find(p => p.name === name);

        if (!proc) {
            log(`⚠️ ${name} not found in PM2 — starting`);
            try {
                execSync(`cd ${PROJECT} && pm2 start ecosystem.config.cjs --only ${name}`, {
                    timeout: 45000, stdio: 'pipe'
                });
                actions.push(`Started missing ${name}`);
            } catch {
                // Timeout doesn't mean failure — pm2 start can take 20-30s for heavy processes.
                // Verify if the process actually appeared before reporting error.
                let started = false;
                try {
                    const checkJson = execSync('pm2 jlist', { encoding: 'utf-8', timeout: 10000 });
                    const checkProcs = JSON.parse(checkJson);
                    started = checkProcs.some(p => p.name === name);
                } catch { /* ignore */ }
                if (started) {
                    actions.push(`Started missing ${name} (slow start)`);
                } else {
                    errors.push({ process: name, error: 'Not found and failed to start' });
                }
            }
            continue;
        }

        const status = proc.pm2_env?.status;
        const restarts = proc.pm2_env?.restart_time || 0;

        // 1. Process crashed or stopped
        if (status === 'errored' || status === 'stopped') {
            log(`❌ ${name} is ${status} (${restarts} restarts) — restarting`);
            pm2Restart(name);
            actions.push(`Restarted ${name} (was ${status})`);
            continue;
        }

        // 2. Crash loop — too many restarts
        if (restarts > 50 && name !== 'pipeline-monitor') {
            const errLog = getErrorLog(name, 5);
            log(`⚠️ ${name} crash loop: ${restarts} restarts`);
            errors.push({ process: name, error: `Crash loop: ${restarts} restarts. Last error: ${errLog.slice(-200)}` });
            continue;
        }

        // 3. pipeline-monitor hung detection
        if (name === 'pipeline-monitor') {
            const lastLog = getLastLog(name, 1);
            if (lastLog === state.lastPipelineLog && state.lastPipelineCheck > 0) {
                const hangDuration = now - state.lastPipelineCheck;
                if (hangDuration > HANG_TIMEOUT) {
                    log(`⚠️ pipeline-monitor hung for ${Math.round(hangDuration / 60000)} min — restarting`);
                    execSync('echo "SOLUTION:OLD" > /tmp/.pipeline_solution_state', { stdio: 'pipe' });
                    pm2Restart('pipeline-monitor');
                    actions.push(`Restarted hung pipeline-monitor (${Math.round(hangDuration / 60000)} min)`);
                    state.lastPipelineLog = '';
                    state.lastPipelineCheck = now;
                }
            } else {
                state.lastPipelineLog = lastLog;
                state.lastPipelineCheck = now;
            }
        }
    }

    // 4. DEPLOY_STATUS: OK stuck — Perplexity didn't respond within 10 min
    {
        try {
            execSync('git fetch origin main --quiet', { cwd: PROJECT, timeout: 10000, stdio: 'pipe' });
            const solution = execSync('git show origin/main:_agents/pipeline/SOLUTION.md', {
                cwd: PROJECT, encoding: 'utf-8', timeout: 10000
            });
            const isDeployed = /^DEPLOY_STATUS:\s*OK\s*$/m.test(solution);

            if (isDeployed) {
                if (!state.deployOkSince) {
                    state.deployOkSince = now;
                } else if (now - state.deployOkSince > PERPLEXITY_TIMEOUT) {
                    log(`⚠️ DEPLOY_STATUS: OK висит ${Math.round((now - state.deployOkSince) / 60000)} мин — Perplexity не ответил`);
                    log(`🔄 Сбрасываю SOLUTION.md → WAITING, перезапускаю pipeline-monitor`);

                    const solutionPath = path.join(PROJECT, '_agents/pipeline/SOLUTION.md');
                    fs.writeFileSync(solutionPath,
                        '# SOLUTION\n\nPHASE: WAITING\nROUND: 0\nTASK: Perplexity не ответил в течение 10 мин — watchdog сбросил\n'
                    );
                    gitCommitAndPush('_agents/pipeline/SOLUTION.md', 'watchdog: reset stuck DEPLOY_STATUS OK — Perplexity timeout');
                    execSync('echo "SOLUTION:OLD" > /tmp/.pipeline_solution_state', { stdio: 'pipe' });
                    pm2Restart('pipeline-monitor');
                    actions.push('Reset stuck DEPLOY_STATUS: OK (Perplexity timeout)');
                    state.deployOkSince = 0;
                }
            } else {
                state.deployOkSince = 0;
            }
        } catch { /* git fetch failed — skip */ }
    }

    // Submit bug report if errors found (with cooldown)
    if (errors.length > 0 && (now - state.lastBugReport > ERROR_COOLDOWN)) {
        log(`🐛 ${errors.length} error(s) — submitting bug report`);
        if (submitBugReport(errors)) {
            state.lastBugReport = now;
        }
    }

    // Log summary
    if (actions.length > 0) {
        log(`📋 Actions: ${actions.join('; ')}`);
    }

    writeState(state);
}

// ── Startup ──────────────────────────────────────────────────────────────────
log('Watchdog started (check every 2 min)');
log(`Monitoring: ${WATCHED_PROCESSES.join(', ')}`);

// Initial check
check();

// Recurring checks
setInterval(check, CHECK_INTERVAL);
