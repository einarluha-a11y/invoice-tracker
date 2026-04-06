#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           HEALTH CHECK — Invoice Tracker System              ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Проверяет все компоненты системы перед запуском агентов.     ║
 * ║  Автоматически чинит что может (npm install, cp .env).       ║
 * ║  Exit 0 = всё ОК, Exit 1 = есть неисправимые проблемы.      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   node automation/health_check.cjs          — полная проверка
 *   node automation/health_check.cjs --fix    — проверка + авторемонт
 *   node automation/health_check.cjs --quiet  — только ошибки
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FIX = process.argv.includes('--fix');
const QUIET = process.argv.includes('--quiet');

// ── Paths ────────────────────────────────────────────────────────────────────
const AUTOMATION_DIR = __dirname;
const PROJECT_ROOT = path.resolve(AUTOMATION_DIR, '..');
const MAIN_REPO = '/Users/einarluha/Downloads/invoice-tracker';

// Detect if running in a worktree
const isWorktree = !AUTOMATION_DIR.startsWith(MAIN_REPO + '/automation');

// ── Colors ───────────────────────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m', bold: '\x1b[1m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', grey: '\x1b[90m',
};

const OK   = `${C.green}✅${C.reset}`;
const FAIL = `${C.red}❌${C.reset}`;
const WARN = `${C.yellow}⚠️${C.reset}`;
const FIX_ICON = `${C.yellow}🔧${C.reset}`;

let blockers = 0;
let warnings = 0;
let fixed = 0;

function log(icon, msg) {
    if (QUIET && icon === OK) return;
    console.log(`  ${icon}  ${msg}`);
}

function check(name, condition, fixFn) {
    if (condition) {
        log(OK, name);
        return true;
    }
    if (FIX && fixFn) {
        try {
            fixFn();
            log(FIX_ICON, `${name} — ${C.green}исправлено${C.reset}`);
            fixed++;
            return true;
        } catch (e) {
            log(FAIL, `${name} — ремонт не удался: ${e.message}`);
            blockers++;
            return false;
        }
    }
    log(FAIL, name);
    blockers++;
    return false;
}

function warn(name, condition) {
    if (condition) {
        log(OK, name);
    } else {
        log(WARN, name);
        warnings++;
    }
}

function fileExists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }
function dirExists(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${C.bold}══════════════════════════════════════════════════${C.reset}`);
console.log(`${C.bold}  HEALTH CHECK — Invoice Tracker${C.reset}`);
console.log(`${C.bold}  Dir: ${C.grey}${AUTOMATION_DIR}${C.reset}`);
if (isWorktree) console.log(`  ${C.yellow}(worktree mode)${C.reset}`);
console.log(`${C.bold}══════════════════════════════════════════════════${C.reset}\n`);

// ── 1. Dependencies ──────────────────────────────────────────────────────────
console.log(`${C.bold}📦 Dependencies${C.reset}`);

check('node_modules (automation)', dirExists(path.join(AUTOMATION_DIR, 'node_modules')),
    () => execSync('npm install --production', { cwd: AUTOMATION_DIR, stdio: 'pipe' }));

const criticalPackages = [
    '@azure/ai-form-recognizer',
    'firebase-admin',
    '@anthropic-ai/sdk',
    'express',
    'imap-simple',
];
for (const pkg of criticalPackages) {
    check(`  ${pkg}`, dirExists(path.join(AUTOMATION_DIR, 'node_modules', ...pkg.split('/'))),
        () => execSync(`npm install ${pkg} --production`, { cwd: AUTOMATION_DIR, stdio: 'pipe' }));
}

// ── 2. Environment ───────────────────────────────────────────────────────────
console.log(`\n${C.bold}🔑 Environment${C.reset}`);

const envPath = path.join(AUTOMATION_DIR, '.env');
const mainEnvPath = path.join(MAIN_REPO, 'automation', '.env');

check('.env exists', fileExists(envPath),
    isWorktree ? () => fs.copyFileSync(mainEnvPath, envPath) : null);

if (fileExists(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const requiredVars = ['ANTHROPIC_API_KEY', 'AZURE_DOC_INTEL_ENDPOINT', 'AZURE_DOC_INTEL_KEY'];
    for (const v of requiredVars) {
        check(`  ${v} set`, envContent.includes(v + '=') && !envContent.includes(v + '=\n'));
    }
}

// Firebase credentials
const credFile = path.join(AUTOMATION_DIR, 'google-credentials.json');
check('Firebase credentials',
    fileExists(credFile) || !!process.env.FIREBASE_SERVICE_ACCOUNT,
    isWorktree ? () => {
        const mainCred = path.join(MAIN_REPO, 'automation', 'google-credentials.json');
        if (fileExists(mainCred)) fs.copyFileSync(mainCred, credFile);
        else throw new Error('no credentials in main repo');
    } : null);

// ── 3. Code Syntax ───────────────────────────────────────────────────────────
console.log(`\n${C.bold}🔍 Code Syntax${C.reset}`);

const cjsFiles = fs.readdirSync(AUTOMATION_DIR)
    .filter(f => f.endsWith('.cjs') && !f.includes('test'));

let syntaxOk = 0;
let syntaxFail = 0;
for (const f of cjsFiles) {
    try {
        execSync(`node --check "${path.join(AUTOMATION_DIR, f)}"`, { stdio: 'pipe' });
        syntaxOk++;
    } catch {
        log(FAIL, `  ${f} — syntax error`);
        syntaxFail++;
        blockers++;
    }
}
if (syntaxFail === 0) log(OK, `All ${syntaxOk} .cjs files — syntax OK`);

// Core modules
const coreDir = path.join(AUTOMATION_DIR, 'core');
if (dirExists(coreDir)) {
    const coreFiles = fs.readdirSync(coreDir).filter(f => f.endsWith('.cjs'));
    for (const f of coreFiles) {
        try {
            execSync(`node --check "${path.join(coreDir, f)}"`, { stdio: 'pipe' });
        } catch {
            log(FAIL, `  core/${f} — syntax error`);
            blockers++;
        }
    }
}

// ── 4. Git Sync ──────────────────────────────────────────────────────────────
console.log(`\n${C.bold}🔄 Git Sync${C.reset}`);

try {
    execSync('git fetch origin main --quiet', { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 10000 });
    const behind = execSync('git rev-list HEAD..origin/main --count', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim();
    if (behind === '0') {
        log(OK, 'Up to date with origin/main');
    } else {
        warn(`Behind origin/main by ${behind} commit(s)`, false);
        if (FIX) {
            try {
                execSync('git pull origin main --rebase', { cwd: PROJECT_ROOT, stdio: 'pipe' });
                log(FIX_ICON, 'Pulled latest from main');
                fixed++;
            } catch (e) {
                log(WARN, `Pull failed (conflicts?): ${e.message.slice(0, 80)}`);
            }
        }
    }
} catch {
    warn('Git fetch (network unavailable?)', false);
}

// ── 5. Firestore ─────────────────────────────────────────────────────────────
console.log(`\n${C.bold}🗄️  Firestore${C.reset}`);

try {
    require('dotenv').config({ path: envPath });
    const { db } = require('./core/firebase.cjs');
    if (db) {
        log(OK, 'Firebase initialized');
    } else {
        log(FAIL, 'Firebase db is null');
        blockers++;
    }
} catch (e) {
    log(FAIL, `Firebase init failed: ${e.message.slice(0, 80)}`);
    blockers++;
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${C.bold}══════════════════════════════════════════════════${C.reset}`);
if (blockers === 0) {
    console.log(`  ${OK}  ${C.green}${C.bold}System healthy${C.reset} (${warnings} warning(s), ${fixed} auto-fixed)`);
    console.log(`${C.bold}══════════════════════════════════════════════════${C.reset}\n`);
    process.exit(0);
} else {
    console.log(`  ${FAIL}  ${C.red}${C.bold}${blockers} blocker(s) found${C.reset} (${warnings} warning(s), ${fixed} auto-fixed)`);
    if (!FIX) console.log(`  ${C.grey}Run with --fix to auto-repair${C.reset}`);
    console.log(`${C.bold}══════════════════════════════════════════════════${C.reset}\n`);
    process.exit(1);
}
