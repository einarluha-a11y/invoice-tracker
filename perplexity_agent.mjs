/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  PERPLEXITY AGENT — Invoice-Tracker Pipeline             ║
 * ║  Роль: независимый ревьюер архитектуры и кода            ║
 * ╚═══════════════════════════════════════════════════════════╝
 *
 * Запуск: node perplexity_agent.mjs
 *
 * Агент поллит GitHub каждые 20 сек.
 * Как только Claude пишет SOLUTION.md — агент читает,
 * делает ревью через Claude API (независимый контекст),
 * пишет REVIEW.md обратно в GitHub.
 * Цикл продолжается до DEPLOY_STATUS: OK.
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';

// ── Config ────────────────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN      = process.env.GITHUB_TOKEN;
const OWNER             = 'einarluha-a11y';
const REPO              = 'invoice-tracker';
const POLL_INTERVAL_MS  = 20_000;

const PATHS = {
  solution:  '_agents/pipeline/SOLUTION.md',
  review:    '_agents/pipeline/REVIEW.md',
  status:    '_agents/pipeline/STATUS.md',
  charter:   '_agents/workflows/chief_accountant.md',
  claudeMd:  'CLAUDE.md',
};

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ── GitHub helpers ─────────────────────────────────────────────────────────────
async function ghGet(path) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`,
    { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET ${path} → ${res.status}`);
  return res.json();
}

async function ghRead(path) {
  const data = await ghGet(path);
  if (!data) return null;
  return Buffer.from(data.content, 'base64').toString('utf8');
}

async function ghWrite(path, content, message) {
  const existing = await ghGet(path);
  const body = {
    message,
    content: Buffer.from(content).toString('base64'),
    ...(existing ? { sha: existing.sha } : {}),
  };
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`GitHub PUT ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Load project context (once) ───────────────────────────────────────────────
async function loadContext() {
  const [claudeMd, charter] = await Promise.all([
    ghRead(PATHS.claudeMd),
    ghRead(PATHS.charter),
  ]);
  return `${claudeMd || ''}\n\n${charter || ''}`;
}

// ── Extract section from SOLUTION.md ─────────────────────────────────────────
function extractSection(content, sectionName) {
  const regex = new RegExp(`## ${sectionName}\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function extractField(content, field) {
  const regex = new RegExp(`${field}:\\s*(.+)`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

// ── Architecture review ────────────────────────────────────────────────────────
async function reviewArchitecture(solution, context) {
  log('🔍 Ревьюю архитектуру...');

  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    system: `Ты — независимый технический ревьюер проекта Invoice-Tracker.
Стек: Node.js CJS backend, React/Vite frontend, Firebase/Firestore, PM2, Railway.

Твоя задача — критически оценить предложенное архитектурное решение.
Проверь:
- Соответствие протоколам Chief Accountant Charter
- Отсутствие противоречий с существующей архитектурой
- Полноту решения (все edge cases учтены?)
- Потенциальные баги

Контекст проекта:
${context.substring(0, 6000)}

Ответь СТРОГО в формате:
ВЕРДИКТ: APPROVED или CHANGES_NEEDED
ОЦЕНКА: [что хорошо, 1-3 предложения]
ЗАМЕЧАНИЯ: [если CHANGES_NEEDED — нумерованный список конкретных проблем; если APPROVED — пусто]`,
    messages: [{ role: 'user', content: `Архитектурное решение:\n\n${solution}` }],
  });

  const text = response.content[0].text;
  const approved = text.includes('ВЕРДИКТ: APPROVED');
  const remarks = text.match(/ЗАМЕЧАНИЯ:([\s\S]*)/)?.[1]?.trim() || '';

  log(approved ? '  ✅ Архитектура одобрена' : `  🔄 Нужны доработки:\n${remarks}`);
  return { approved, text, remarks };
}

// ── Code review ───────────────────────────────────────────────────────────────
async function reviewCode(codeSection, changedFiles, context) {
  log('🔍 Делаю code review...');

  // Пытаемся прочитать изменённые файлы из GitHub
  let filesContent = '';
  if (changedFiles) {
    const fileList = changedFiles.split('\n').map(f => f.replace(/^[-*]\s*`?/, '').replace(/`$/, '').trim()).filter(Boolean);
    for (const f of fileList.slice(0, 4)) {
      const content = await ghRead(f);
      if (content) filesContent += `\n### ${f}\n\`\`\`\n${content.substring(0, 2500)}\n\`\`\`\n`;
    }
  }

  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 2048,
    system: `Ты — code reviewer проекта Invoice-Tracker.
Стек: Node.js CJS, Firebase, PM2.

Проверь код на:
1. Соответствие всем протоколам Chief Accountant Charter (особенно: PM2 restart после изменений, parseNumGlobal для сумм, anti-hallucination, idempotency)
2. Синтаксические ошибки и очевидные баги
3. Полноту реализации (все edge cases?)
4. Безопасность и надёжность

Контекст (Chief Accountant Charter):
${context.substring(0, 5000)}

Ответь СТРОГО в формате:
ВЕРДИКТ: CODE_APPROVED или CODE_CHANGES_NEEDED
ОЦЕНКА: [что реализовано правильно]
ПРОБЛЕМЫ: [если CODE_CHANGES_NEEDED — нумерованный список конкретных проблем с указанием файла и строки; если CODE_APPROVED — пусто]`,
    messages: [{
      role: 'user',
      content: `Описание реализации:\n${codeSection}\n\nКод изменённых файлов:${filesContent || ' (файлы недоступны — оцени по описанию)'}`,
    }],
  });

  const text = response.content[0].text;
  const approved = text.includes('ВЕРДИКТ: CODE_APPROVED');
  const problems = text.match(/ПРОБЛЕМЫ:([\s\S]*)/)?.[1]?.trim() || '';

  log(approved ? '  ✅ Код одобрен' : `  🔄 Нужны исправления:\n${problems}`);
  return { approved, text, problems };
}

// ── Write REVIEW.md ────────────────────────────────────────────────────────────
async function writeReview(verdictText, round, phase) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const content = `# REVIEW от Perplexity — ${timestamp}
<!-- phase: ${phase} | round: ${round} -->

${verdictText}

---
*Этот файл сгенерирован автоматически Perplexity Agent*
*Claude должен прочитать этот файл и отреагировать согласно workflow*
`;
  await ghWrite(PATHS.review, content, `perplexity: review ${phase} round ${round}`);
  log(`📤 REVIEW.md записан в GitHub (${phase}, раунд ${round})`);
}

// ── Write STATUS.md ────────────────────────────────────────────────────────────
async function writeStatus(status, details = '') {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 16);
  const content = `# Pipeline Status — ${timestamp}

**Статус:** ${status}
${details ? `\n**Детали:** ${details}` : ''}

## Что происходит
${getStatusDescription(status)}
`;
  await ghWrite(PATHS.status, content, `orchestrator: status → ${status}`);
}

function getStatusDescription(status) {
  const map = {
    'WAITING_FOR_ARCHITECTURE': '⏳ Ожидаю архитектурное решение от Claude',
    'REVIEWING_ARCHITECTURE':   '🔍 Perplexity анализирует архитектуру',
    'ARCHITECTURE_APPROVED':    '✅ Архитектура одобрена — Claude кодирует',
    'WAITING_FOR_CODE':         '⏳ Ожидаю реализацию от Claude',
    'REVIEWING_CODE':           '🔍 Perplexity делает code review',
    'CODE_APPROVED':            '✅ Код одобрен — Claude деплоит',
    'WAITING_FOR_DEPLOY':       '⏳ Ожидаю деплой и проверку от Claude',
    'DONE':                     '🎉 Задача выполнена успешно!',
    'FAILED':                   '❌ Задача завершилась с ошибкой',
  };
  return map[status] || status;
}

// ── Logger ────────────────────────────────────────────────────────────────────
function log(msg) {
  const time = new Date().toISOString().substring(11, 19);
  console.log(`[${time}] ${msg}`);
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
async function poll(context, state) {
  const solution = await ghRead(PATHS.solution);
  if (!solution) return state;

  const phase         = extractField(solution, 'PHASE');
  const claudeRound   = extractField(solution, 'ROUND');
  const deployStatus  = extractField(solution, 'DEPLOY_STATUS');

  // ── Финиш ──
  if (deployStatus === 'OK') {
    log('🎉 DEPLOY_STATUS: OK — задача полностью завершена!');
    await writeStatus('DONE');
    state.done = true;
    return state;
  }
  if (deployStatus === 'FAILED') {
    log('❌ DEPLOY_STATUS: FAILED — деплой упал');
    await writeStatus('FAILED', 'Деплой завершился с ошибкой');
    state.done = true;
    state.failed = true;
    return state;
  }

  // ── Архитектурная фаза ──
  if (phase === 'ARCHITECTURE') {
    const roundNum = parseInt(claudeRound) || 1;
    if (state.lastArchRound === roundNum) return state; // уже ревьюили этот раунд

    await writeStatus('REVIEWING_ARCHITECTURE', `раунд ${roundNum}`);
    const archSection = extractSection(solution, 'ARCHITECTURE');
    if (!archSection) return state;

    const { approved, text, remarks } = await reviewArchitecture(archSection, context);

    await writeReview(text, roundNum, 'architecture');

    if (approved) {
      await writeStatus('ARCHITECTURE_APPROVED');
      state.archApproved = true;
    }
    state.lastArchRound = roundNum;
  }

  // ── Кодовая фаза ──
  if (phase === 'CODE') {
    const roundNum = parseInt(claudeRound) || 1;
    if (state.lastCodeRound === roundNum) return state;

    await writeStatus('REVIEWING_CODE', `раунд ${roundNum}`);
    const codeSection    = extractSection(solution, 'CODE');
    const changedFiles   = extractSection(solution, 'CHANGED_FILES');
    if (!codeSection) return state;

    const { approved, text, problems } = await reviewCode(codeSection, changedFiles, context);

    await writeReview(text, roundNum, 'code');

    if (approved) {
      await writeStatus('CODE_APPROVED');
      state.codeApproved = true;
    }
    state.lastCodeRound = roundNum;
  }

  // ── Деплой фаза ──
  if (phase === 'DEPLOYING') {
    if (!state.waitingDeploy) {
      await writeStatus('WAITING_FOR_DEPLOY');
      state.waitingDeploy = true;
      log('⏳ Claude деплоит — жду DEPLOY_STATUS...');
    }
  }

  return state;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!ANTHROPIC_API_KEY) { console.error('❌ Нужен ANTHROPIC_API_KEY'); process.exit(1); }
  if (!GITHUB_TOKEN)      { console.error('❌ Нужен GITHUB_TOKEN'); process.exit(1); }

  log('🚀 Perplexity Agent запущен — мониторю GitHub репозиторий...');
  log(`   Репо: https://github.com/${OWNER}/${REPO}`);
  log(`   Интервал поллинга: ${POLL_INTERVAL_MS / 1000} сек\n`);

  const context = await loadContext();
  log('📚 Контекст проекта загружен\n');

  await writeStatus('WAITING_FOR_ARCHITECTURE', 'Жду первое решение от Claude');

  let state = {
    lastArchRound: 0,
    lastCodeRound: 0,
    archApproved: false,
    codeApproved: false,
    waitingDeploy: false,
    done: false,
    failed: false,
  };

  while (!state.done) {
    try {
      state = await poll(context, state);
    } catch (err) {
      log(`⚠️  Ошибка поллинга: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  log(state.failed ? '❌ Pipeline завершён с ошибкой.' : '🎉 Pipeline завершён успешно!');
}

main();
