#!/usr/bin/env node
/**
 * Pipeline Monitor — проверяет SOLUTION.md и REVIEW.md каждые 30 сек.
 * При изменении запускает Claude CLI для выполнения задания.
 * Работает как PM2 процесс — 24/7, перезапуск при падении.
 */

'use strict';

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT = '/Users/einarluha/Downloads/invoice-tracker';
const STATE_SOL = '/tmp/.pipeline_solution_state';
const STATE_REV = '/tmp/.pipeline_review_state';
const POLL_INTERVAL = 30000; // 30 sec

function log(msg) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function gitFetch() {
    try {
        execSync('git fetch origin main --quiet', { cwd: PROJECT, timeout: 15000, stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

function gitShow(filePath) {
    try {
        return execSync(`git show origin/main:${filePath}`, { cwd: PROJECT, encoding: 'utf-8', timeout: 10000 });
    } catch {
        return '';
    }
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

function runClaude(prompt) {
    log('🤖 Запускаю Claude CLI...');
    try {
        const result = execSync(
            `claude --dangerously-skip-permissions -p "${prompt.replace(/"/g, '\\"')}" --max-turns 50`,
            { cwd: PROJECT, encoding: 'utf-8', timeout: 600000, stdio: 'pipe' }
        );
        log('✅ Claude завершил');
        return result;
    } catch (err) {
        log('❌ Claude ошибка: ' + (err.message || '').slice(0, 200));
        return null;
    }
}

async function pollOnce() {
    if (!gitFetch()) return;

    // ── 1. SOLUTION.md (новые задания) ──
    const solution = gitShow('_agents/pipeline/SOLUTION.md');
    const sol = parsePhaseRound(solution, 'solution');
    const solState = `SOLUTION:${sol.phase}:${sol.round}`;
    const savedSol = readState(STATE_SOL);

    if (solState !== savedSol && sol.phase && sol.phase !== 'WAITING' && !solution.includes('DEPLOY_STATUS: OK')) {
        writeState(STATE_SOL, solState);
        log(`📋 Новое задание: ${sol.phase} round ${sol.round}`);
        runClaude(
            `Ты — автономный агент Invoice Tracker. Рабочая директория: ${PROJECT}. ` +
            `Прочитай _agents/pipeline/SOLUTION.md из origin/main (git show origin/main:_agents/pipeline/SOLUTION.md). ` +
            `Выполни задание. Соблюдай протоколы из CLAUDE.md. ` +
            `После: node --check, DEPLOY_STATUS: OK в SOLUTION.md, коммит, пуш. Русский, коротко.`
        );
    } else if (solState !== savedSol) {
        writeState(STATE_SOL, solState);
    }

    // ── 2. REVIEW.md (ревью от Perplexity) ──
    const review = gitShow('_agents/pipeline/REVIEW.md');
    const rev = parsePhaseRound(review, 'review');
    const revState = `REVIEW:${rev.phase}:${rev.round}`;
    const savedRev = readState(STATE_REV);

    if (revState !== savedRev && rev.phase && rev.round) {
        writeState(STATE_REV, revState);
        const verdict = (review.match(/ВЕРДИКТ:\s*([A-Z_]+)/) || [])[1] || '';
        log(`📋 Ревью: ${rev.phase} round ${rev.round} — ${verdict}`);

        if (verdict.includes('CHANGES_NEEDED')) {
            runClaude(
                `Ты — автономный агент Invoice Tracker. Рабочая директория: ${PROJECT}. ` +
                `Прочитай _agents/pipeline/REVIEW.md из origin/main. Вердикт: ${verdict}. ` +
                `Прочитай замечания, исправь код, обнови SOLUTION.md (ROUND+1), запуши. Русский.`
            );
        }
    }
}

// ── Main loop ────────────────────────────────────────────────────────────────
log('Pipeline monitor started (poll every 30s)');

// Init states if missing
if (!readState(STATE_SOL)) {
    gitFetch();
    const sol = parsePhaseRound(gitShow('_agents/pipeline/SOLUTION.md'), 'solution');
    writeState(STATE_SOL, `SOLUTION:${sol.phase}:${sol.round}`);
}
if (!readState(STATE_REV)) {
    gitFetch();
    const rev = parsePhaseRound(gitShow('_agents/pipeline/REVIEW.md'), 'review');
    writeState(STATE_REV, `REVIEW:${rev.phase}:${rev.round}`);
}

setInterval(pollOnce, POLL_INTERVAL);
pollOnce(); // первый запуск сразу
