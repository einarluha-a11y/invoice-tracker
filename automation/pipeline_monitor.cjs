#!/usr/bin/env node
/**
 * Pipeline Monitor — PM2 процесс, работает 24/7.
 *
 * 1. Проверяет SOLUTION.md / REVIEW.md каждые 30 сек → запускает Claude CLI
 * 2. Проверяет PM2 логи на ошибки каждые 60 сек → отправляет баг-репорт в SOLUTION.md
 *    → Perplexity ревьюит → Claude CLI исправляет → цикл
 */

'use strict';

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT = '/Users/einarluha/Downloads/invoice-tracker';
const STATE_SOL = '/tmp/.pipeline_solution_state';
const STATE_REV = '/tmp/.pipeline_review_state';
const STATE_ERR = '/tmp/.pipeline_error_state';
const POLL_INTERVAL = 30000;  // 30 sec — tasks/reviews
const ERROR_INTERVAL = 60000; // 60 sec — error monitoring

function log(msg) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function gitFetch() {
    try {
        execSync('git fetch origin main --quiet', { cwd: PROJECT, timeout: 15000, stdio: 'pipe' });
        return true;
    } catch { return false; }
}

function gitShow(filePath) {
    try {
        return execSync(`git show origin/main:${filePath}`, { cwd: PROJECT, encoding: 'utf-8', timeout: 10000 });
    } catch { return ''; }
}

function readState(file) {
    try { return fs.readFileSync(file, 'utf-8').trim(); } catch { return ''; }
}

function writeState(file, state) {
    fs.writeFileSync(file, state + '\n');
}

function parsePhaseRound(text, type) {
    if (type === 'solution') {
        const phase = (text.match(/^PHASE:\s*(\S+)/m) || [])[1] || '';
        const round = (text.match(/^ROUND:\s*(\S+)/m) || [])[1] || '';
        return { phase, round };
    } else {
        const phase = (text.match(/phase:\s*([A-Z_]+)/i) || [])[1] || '';
        const round = (text.match(/round:\s*(\d+)/i) || [])[1] || '';
        return { phase, round };
    }
}

let claudeRunning = false;
let claudeStartedAt = 0;

function runClaude(prompt) {
    if (claudeRunning) {
        // Safety: if flag stuck for >15 min, force reset
        if (Date.now() - claudeStartedAt > 900000) {
            log('⚠️ claudeRunning stuck >15 min — force reset');
            claudeRunning = false;
        } else {
            return 'BUSY';
        }
    }
    claudeRunning = true;
    claudeStartedAt = Date.now();
    log('🤖 Запускаю Claude CLI...');

    const child = spawn('claude', [
        '--dangerously-skip-permissions',
        '-p', prompt,
        '--max-turns', '100'
    ], { cwd: PROJECT, stdio: 'pipe', env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' } });

    let output = '';
    child.stdout.on('data', d => output += d.toString());
    child.stderr.on('data', d => output += d.toString());

    child.on('close', (code) => {
        claudeRunning = false;
        if (code === 0) {
            log('✅ Claude завершил');
            // Deploy
            try {
                execSync('git pull origin main --rebase', { cwd: PROJECT, timeout: 15000, stdio: 'pipe' });
                execSync('pm2 restart invoice-api invoice-imap', { timeout: 15000, stdio: 'pipe' });
                log('🚀 Deploy: pulled + restarted invoice-api/imap');
            } catch (e) {
                log('⚠️ Deploy failed: ' + (e.message || '').slice(0, 100));
            }
            // Update STATUS.md with completion report
            try {
                const statusPath = path.join(PROJECT, '_agents/pipeline/STATUS.md');
                const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
                const currentTask = readState(STATE_SOL).split(':').slice(2).join(':') || 'unknown';
                const entry = `- ${now} — ✅ Завершено: ${currentTask.slice(0, 80)}\n`;
                let status = '';
                try { status = fs.readFileSync(statusPath, 'utf-8'); } catch {}
                const insertAt = status.indexOf('\n- ');
                if (insertAt > 0) {
                    status = status.slice(0, insertAt) + '\n' + entry + status.slice(insertAt + 1);
                } else {
                    status += '\n' + entry;
                }
                fs.writeFileSync(statusPath, status);
                execSync(`cd ${PROJECT} && git add _agents/pipeline/STATUS.md && git commit -m "status: task completed" && git push origin main`, { timeout: 15000, stdio: 'pipe' });
                log('📝 STATUS.md обновлён');
            } catch { /* non-critical */ }
        } else {
            log('❌ Claude ошибка (exit ' + code + '): ' + output.slice(-200));
        }
    });

    child.on('error', (err) => {
        claudeRunning = false;
        log('❌ Claude spawn error: ' + err.message);
    });

    return 'STARTED';
}

// ── Git commit + push helper ─────────────────────────────────────────────────
function gitCommitAndPush(file, message) {
    try {
        execSync(`git add ${file} && git commit -m "${message}" && git push origin HEAD:main`, {
            cwd: PROJECT, timeout: 30000, stdio: 'pipe'
        });
        return true;
    } catch (err) {
        // If behind remote, pull and retry
        try {
            execSync('git pull origin main --rebase', { cwd: PROJECT, timeout: 15000, stdio: 'pipe' });
            execSync(`git add ${file} && git commit -m "${message}" && git push origin HEAD:main`, {
                cwd: PROJECT, timeout: 30000, stdio: 'pipe'
            });
            return true;
        } catch {
            log('❌ Git push failed: ' + (err.message || '').slice(0, 100));
            return false;
        }
    }
}

// ── PM2 Error Monitor ────────────────────────────────────────────────────────
function checkPm2Errors() {
    const CRITICAL_PATTERNS = [
        /Cannot find module/i,
        /SyntaxError/i,
        /TypeError.*is not a function/i,
        /FATAL|CRASH/i,
        /storage\/invalid-argument/i,
        /ECONNREFUSED.*firestore/i,
    ];
    // Ignore patterns (known non-critical)
    const IGNORE_PATTERNS = [
        /AUTHENTICATIONFAILED/i,  // known bad IMAP cred in root .env
        /Invalid credentials/i,
    ];

    const processes = ['invoice-api', 'invoice-imap'];
    const errors = [];

    for (const proc of processes) {
        try {
            const logs = execSync(
                `pm2 logs ${proc} --lines 20 --nostream --err 2>/dev/null`,
                { cwd: PROJECT, encoding: 'utf-8', timeout: 5000 }
            );
            for (const line of logs.split('\n')) {
                if (IGNORE_PATTERNS.some(p => p.test(line))) continue;
                if (CRITICAL_PATTERNS.some(p => p.test(line))) {
                    const matched = CRITICAL_PATTERNS.find(p => p.test(line));
                    errors.push({ process: proc, error: line.trim().slice(0, 200), pattern: matched.toString() });
                }
            }
        } catch { /* pm2 logs failed — skip */ }
    }

    // Check for real crash loops: process is in 'errored' state OR uptime < 10s (rapid crash-restart)
    // Ignore restart_time counter — watch:true triggers restarts on file changes, not crashes
    try {
        const list = execSync('pm2 jlist', { cwd: PROJECT, encoding: 'utf-8', timeout: 5000 });
        const procs = JSON.parse(list);
        const now = Date.now();
        for (const p of procs) {
            if (!processes.includes(p.name)) continue;
            const status = p.pm2_env.status;
            const uptime = now - (p.pm2_env.pm_uptime || 0);
            if (status === 'errored') {
                errors.push({ process: p.name, error: `Process in errored state (exceeded max_restarts)`, pattern: 'restart_count' });
            } else if (status === 'online' && uptime < 10000 && p.pm2_env.unstable_restarts > 5) {
                errors.push({ process: p.name, error: `Crash loop: ${p.pm2_env.unstable_restarts} unstable restarts, uptime ${Math.round(uptime/1000)}s`, pattern: 'restart_count' });
            }
        }
    } catch { /* ignore */ }

    return errors;
}

function submitBugReport(errors) {
    const errorSummary = errors.map(e => `- **${e.process}**: ${e.error}`).join('\n');
    const bugReport = `# SOLUTION

PHASE: BUGFIX
ROUND: 1
TASK: PM2 автоматический баг-репорт — критические ошибки

## ОШИБКИ В PM2 ЛОГАХ

${errorSummary}

## ЗАДАНИЕ

Проанализируй ошибки выше. Найди причину в коде, исправь, проверь syntax (node --check), закоммить и запуши.
После исправления добавь DEPLOY_STATUS: OK в конец этого файла.

## Верификация
- \`node --check\` всех изменённых файлов
- PM2 процессы стабильны (0 рестартов за 1 минуту)
`;

    const solutionPath = path.join(PROJECT, '_agents/pipeline/SOLUTION.md');
    fs.writeFileSync(solutionPath, bugReport);

    if (gitCommitAndPush('_agents/pipeline/SOLUTION.md', 'pipeline-monitor: auto bug report from PM2 errors')) {
        log('🐛 Баг-репорт отправлен в SOLUTION.md');
        return true;
    }
    return false;
}

// ── Poll tasks/reviews ───────────────────────────────────────────────────────
async function pollOnce() {
    if (!gitFetch()) return;

    // ── 1. SOLUTION.md (новые задания) ──
    const solution = gitShow('_agents/pipeline/SOLUTION.md');
    const sol = parsePhaseRound(solution, 'solution');
    const task = (solution.match(/^TASK:\s*(.+)/m) || [])[1] || '';
    const solState = `SOLUTION:${sol.phase}:${sol.round}:${task.slice(0, 50)}`;
    const savedSol = readState(STATE_SOL);

    // Check DEPLOY_STATUS: OK on its own line (not inside instructions text)
    const isDeployed = /^DEPLOY_STATUS:\s*OK\s*$/m.test(solution);
    if (solState !== savedSol && sol.phase && sol.phase !== 'WAITING' && !isDeployed) {
        log(`📋 Новое задание: ${sol.phase} round ${sol.round}`);
        const status = runClaude(
            `Ты — автономный агент Invoice Tracker. Рабочая директория: ${PROJECT}. ` +
            `Прочитай _agents/pipeline/SOLUTION.md из origin/main (git show origin/main:_agents/pipeline/SOLUTION.md). ` +
            `Выполни задание. Соблюдай протоколы из CLAUDE.md. ` +
            `После: node --check, DEPLOY_STATUS: OK в SOLUTION.md, коммит, пуш. Русский, коротко.`
        );
        if (status === 'STARTED' || status === 'BUSY') {
            writeState(STATE_SOL, solState); // Claude работает в фоне, не блокируем
        }
    } else if (solState !== savedSol) {
        writeState(STATE_SOL, solState);
    }

    // ── 2. REVIEW.md (ревью от Perplexity) ──
    const review = gitShow('_agents/pipeline/REVIEW.md');
    const rev = parsePhaseRound(review, 'review');
    const revState = `REVIEW:${rev.phase}:${rev.round}`;
    const savedRev = readState(STATE_REV);

    if (revState !== savedRev && rev.phase && rev.round) {
        const verdict = (review.match(/ВЕРДИКТ:\s*([A-Z_]+)/) || [])[1] || '';
        log(`📋 Ревью: ${rev.phase} round ${rev.round} — ${verdict}`);

        if (verdict.includes('CHANGES_NEEDED')) {
            runClaude(
                `Ты — автономный агент Invoice Tracker. Рабочая директория: ${PROJECT}. ` +
                `Прочитай _agents/pipeline/REVIEW.md из origin/main. Вердикт: ${verdict}. ` +
                `Прочитай замечания, исправь код, обнови SOLUTION.md (ROUND+1), запуши. Русский.`
            );
        }
        writeState(STATE_REV, revState);
    }
}

// ── Poll PM2 errors ──────────────────────────────────────────────────────────
function pollErrors() {
    const errors = checkPm2Errors();
    if (errors.length === 0) return;

    // Dedup: don't report same error twice
    const errorKey = errors.map(e => e.error.slice(0, 50)).sort().join('|');
    const savedErr = readState(STATE_ERR);
    if (errorKey === savedErr) return;

    log(`🐛 Найдено ${errors.length} критических ошибок в PM2`);
    errors.forEach(e => log(`  ${e.process}: ${e.error.slice(0, 100)}`));

    if (submitBugReport(errors)) {
        writeState(STATE_ERR, errorKey);
    }
}

// ── Main loop ────────────────────────────────────────────────────────────────
log('Pipeline monitor started (tasks: 30s, errors: 60s)');

// Init states if missing
if (!readState(STATE_SOL)) {
    gitFetch();
    const sol = parsePhaseRound(gitShow('_agents/pipeline/SOLUTION.md'), 'solution');
    const task = (gitShow('_agents/pipeline/SOLUTION.md').match(/^TASK:\s*(.+)/m) || [])[1] || '';
    writeState(STATE_SOL, `SOLUTION:${sol.phase}:${sol.round}:${task.slice(0, 50)}`);
}
if (!readState(STATE_REV)) {
    gitFetch();
    const rev = parsePhaseRound(gitShow('_agents/pipeline/REVIEW.md'), 'review');
    writeState(STATE_REV, `REVIEW:${rev.phase}:${rev.round}`);
}

setInterval(pollOnce, POLL_INTERVAL);
setInterval(pollErrors, ERROR_INTERVAL);
pollOnce();
