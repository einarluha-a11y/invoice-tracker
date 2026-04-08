#!/usr/bin/env python3
"""
Perplexity Review + Next Task — GitHub Actions entry point.

Reads _agents/pipeline/SOLUTION.md, determines phase:
- Normal phase: calls Perplexity for code review → writes REVIEW.md
- DEPLOY_STATUS: OK: calls Perplexity for review + next task → writes REVIEW.md + SOLUTION.md
"""

import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

API_KEY = os.environ.get("PERPLEXITY_API_KEY")
if not API_KEY:
    print("ERROR: PERPLEXITY_API_KEY not set", file=sys.stderr)
    sys.exit(1)

ROOT = Path(".")
SOLUTION_PATH = ROOT / "_agents/pipeline/SOLUTION.md"
REVIEW_PATH = ROOT / "_agents/pipeline/REVIEW.md"
BACKLOG_PATH = ROOT / "_agents/tasks/BACKLOG.md"
CHARTER_PATH = ROOT / "_agents/workflows/chief_accountant.md"
CLAUDE_MD_PATH = ROOT / "CLAUDE.md"

def read_file(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""

def extract_field(text: str, field: str, default: str = "") -> str:
    match = re.search(rf"^{re.escape(field)}:\s*(\S+)", text, re.MULTILINE)
    return match.group(1) if match else default

def call_perplexity(system_prompt: str, user_content: str, max_tokens: int = 2048) -> str:
    payload = {
        "model": "sonar-pro",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.2,
    }
    req = urllib.request.Request(
        "https://api.perplexity.ai/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"ERROR: Perplexity HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"ERROR: Perplexity URL error: {e}", file=sys.stderr)
        sys.exit(1)

    if "error" in data:
        print(f"ERROR: Perplexity API returned error: {data['error']}", file=sys.stderr)
        sys.exit(1)

    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        print(f"ERROR: unexpected Perplexity response: {data}", file=sys.stderr)
        sys.exit(1)

def build_review_prompt(phase: str, context: str) -> str:
    context_trimmed = context[:6000]
    if phase == "ARCHITECTURE":
        role = (
            "Ты — независимый технический ревьюер проекта Invoice-Tracker "
            "(Node.js CJS backend, React/Vite frontend, Firebase/Firestore, PM2, Railway). "
            "Критически оцени архитектурное решение. Проверь: соответствие Chief Accountant Charter, "
            "отсутствие противоречий с существующей архитектурой, полноту (edge cases), потенциальные баги.\n\n"
            "Отвечай СТРОГО в формате:\n"
            "ВЕРДИКТ: APPROVED или CHANGES_NEEDED\n"
            "ОЦЕНКА: [1-3 предложения что хорошо]\n"
            "ЗАМЕЧАНИЯ: [нумерованный список если CHANGES_NEEDED, пусто если APPROVED]"
        )
    elif phase == "CODE":
        role = (
            "Ты — code reviewer Invoice-Tracker. Проверь: протоколы Chief Accountant Charter "
            "(PM2 restart после automation/, parseNumGlobal для сумм, anti-hallucination, idempotency), "
            "синтаксические ошибки, полноту, безопасность.\n\n"
            "Отвечай СТРОГО:\n"
            "ВЕРДИКТ: CODE_APPROVED или CODE_CHANGES_NEEDED\n"
            "ОЦЕНКА: [что реализовано правильно]\n"
            "ПРОБЛЕМЫ: [нумерованный список с файл:строка]"
        )
    else:
        role = (
            "Ты — независимый ревьюер Invoice-Tracker. Проанализируй решение и ответь в формате: "
            "ВЕРДИКТ + ОЦЕНКА + ЗАМЕЧАНИЯ."
        )
    return f"{role}\n\nКонтекст проекта:\n{context_trimmed}"

def get_next_task_from_backlog(backlog: str) -> tuple:
    """Детерминированно возвращает (task_id, task_text) первой невыполненной задачи.
    Пропускает секцию 'Ожидают credentials'. Возвращает (None, None) если всё сделано."""
    lines = backlog.split('\n')
    in_skip_section = False
    for line in lines:
        # Определяем секции
        if re.match(r'^##\s+.*[Оо]жидают', line):
            in_skip_section = True
            continue
        if re.match(r'^##\s+', line) and not re.match(r'^##\s+.*[Оо]жидают', line):
            in_skip_section = False

        if in_skip_section:
            continue

        # Первая незакрытая задача
        if re.match(r'^- \[ \]', line):
            task_text = re.sub(r'^- \[ \]\s*', '', line).strip()
            # Извлекаем TASK-XX если есть
            m = re.match(r'(TASK-\d+)', task_text)
            task_id = m.group(1) if m else None
            return task_id, task_text

    return None, None


def assign_next_task_number(backlog: str) -> str:
    """Считает существующие TASK-XX в BACKLOG и возвращает следующий номер."""
    existing = re.findall(r'TASK-(\d+)', backlog)
    if not existing:
        return 'TASK-11'
    return f'TASK-{max(int(n) for n in existing) + 1}'


def mark_task_done_in_backlog(task_field: str) -> bool:
    """Отмечает задачу как [x] в BACKLOG.md по TASK-XX или тексту из SOLUTION.md TASK поля."""
    if not BACKLOG_PATH.exists():
        return False
    content = BACKLOG_PATH.read_text(encoding='utf-8')

    # Попытка 1: по TASK-XX номеру
    m = re.match(r'(TASK-\d+)', task_field)
    if m:
        task_id = m.group(1)
        new_content = re.sub(
            rf'^(- )\[ \] ({re.escape(task_id)})',
            r'\1[x] \2',
            content,
            flags=re.MULTILINE
        )
        if new_content != content:
            BACKLOG_PATH.write_text(new_content, encoding='utf-8')
            print(f"BACKLOG: отмечен как выполненный {task_id}")
            return True

    # Попытка 2: по ключевым словам из TASK поля (первые 40 символов)
    task_snippet = task_field[:40].strip()
    for line in content.split('\n'):
        if re.match(r'^- \[ \]', line) and task_snippet and task_snippet[:20].lower() in line.lower():
            new_content = content.replace(line, line.replace('[ ]', '[x]'), 1)
            BACKLOG_PATH.write_text(new_content, encoding='utf-8')
            print(f"BACKLOG: отмечен через text-match: {line[:60]}")
            return True

    print(f"BACKLOG: задача не найдена для отметки: {task_field[:60]}")
    return False


def build_next_task_prompt(context: str, next_task_id: str, next_task_text: str, completed_task: str) -> str:
    """Perplexity расширяет КОНКРЕТНУЮ задачу из BACKLOG в полный SOLUTION.md.
    Задача уже выбрана детерминированно — LLM только добавляет детали реализации."""
    context_trimmed = context[:4000]
    return (
        "Ты — технический менеджер проекта Invoice-Tracker. "
        "Claude только что завершил задачу. Следующая задача уже выбрана из бэклога.\n\n"
        "Твоя единственная задача: написать подробный SOLUTION.md для этой конкретной задачи.\n\n"
        f"СЛЕДУЮЩАЯ ЗАДАЧА (обязательно использовать именно эту, не менять):\n"
        f"{next_task_id or 'без номера'}: {next_task_text}\n\n"
        "ФОРМАТ ОТВЕТА — точно этот markdown:\n\n"
        "```solution\n"
        "# SOLUTION\n\n"
        f"PHASE: ARCHITECTURE\n"
        f"ROUND: 1\n"
        f"TASK: {next_task_id + ' — ' if next_task_id else ''}{next_task_text}\n\n"
        "## ЗАДАНИЕ\n\n"
        "[Подробное описание что Claude должен сделать — файлы, функции, алгоритм]\n\n"
        "## Верификация\n"
        "[Как проверить что задание выполнено — конкретные команды или признаки]\n"
        "```\n\n"
        f"Завершённая задача (для контекста):\n{completed_task[:1500]}\n\n"
        f"Контекст проекта:\n{context_trimmed}"
    )

def write_review(phase: str, round_num: str, content: str):
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    review = (
        f"# REVIEW от Perplexity — {timestamp}\n"
        f"<!-- phase: {phase} | round: {round_num} -->\n\n"
        f"{content}\n\n"
        f"---\n"
        f"*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*\n"
        f"*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*\n"
    )
    REVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
    REVIEW_PATH.write_text(review, encoding="utf-8")
    print(f"REVIEW.md written ({len(review)} bytes)")

def write_solution(content: str):
    """Extract solution from Perplexity response and write SOLUTION.md"""
    # Try to extract ```solution ... ``` block
    match = re.search(r"```solution\s*\n(.*?)```", content, re.DOTALL)
    if match:
        solution_text = match.group(1).strip()
    else:
        # Fallback: look for # SOLUTION header
        match = re.search(r"(# SOLUTION.*)", content, re.DOTALL)
        if match:
            solution_text = match.group(1).strip()
        else:
            print("WARNING: Could not extract SOLUTION from Perplexity response", file=sys.stderr)
            return False

    SOLUTION_PATH.write_text(solution_text + "\n", encoding="utf-8")
    print(f"SOLUTION.md written ({len(solution_text)} bytes)")
    return True

def main() -> int:
    solution = read_file(SOLUTION_PATH)
    if not solution:
        print("ERROR: SOLUTION.md not found or empty", file=sys.stderr)
        return 1

    phase = extract_field(solution, "PHASE", "UNKNOWN")
    round_num = extract_field(solution, "ROUND", "1")
    task = extract_field(solution, "TASK", "")
    print(f"Phase: {phase}, Round: {round_num}, Task: {task}")

    charter = read_file(CHARTER_PATH)
    claude_md = read_file(CLAUDE_MD_PATH)
    context = f"{claude_md}\n\n{charter}"

    # ── DEPLOY_STATUS: OK → review completed task + generate next task ──
    if "DEPLOY_STATUS: OK" in solution:
        print("DEPLOY_STATUS: OK detected — reviewing + generating next task")

        # Step 1: Quick review of completed work
        review_prompt = build_review_prompt(phase, context)
        review_content = call_perplexity(review_prompt, solution)
        write_review(phase, round_num, review_content)

        # Step 2: Mark completed task in BACKLOG
        # Extract full TASK line (not just first word) for matching
        task_full = ""
        m = re.search(r"^TASK:\s*(.+)$", solution, re.MULTILINE)
        if m:
            task_full = m.group(1).strip()
        mark_task_done_in_backlog(task_full)

        # Step 3: Deterministically pick next task from BACKLOG
        backlog = read_file(BACKLOG_PATH)
        next_task_id, next_task_text = get_next_task_from_backlog(backlog)

        if not next_task_text:
            SOLUTION_PATH.write_text(
                "# SOLUTION\n\nPHASE: WAITING\nROUND: 0\n"
                "TASK: все задачи из BACKLOG выполнены — ожидаю новых\n",
                encoding="utf-8"
            )
            print("✅ Все задачи выполнены → PHASE: WAITING")
            return 0

        # Assign TASK number if task doesn't have one
        if not next_task_id:
            next_task_id = assign_next_task_number(backlog)
            print(f"Новый номер задачи: {next_task_id}")

        print(f"Следующая задача: {next_task_id} — {next_task_text[:60]}")

        # Step 4: Ask Perplexity to expand the specific task into full SOLUTION.md
        next_task_prompt = build_next_task_prompt(context, next_task_id, next_task_text, solution)
        next_task_content = call_perplexity(next_task_prompt, solution, max_tokens=3000)

        if write_solution(next_task_content):
            print(f"✅ SOLUTION.md написан для {next_task_id}")
        else:
            # Fallback: write minimal SOLUTION without Perplexity expansion
            fallback = (
                f"# SOLUTION\n\n"
                f"PHASE: ARCHITECTURE\n"
                f"ROUND: 1\n"
                f"TASK: {next_task_id} — {next_task_text}\n\n"
                f"## ЗАДАНИЕ\n\n"
                f"{next_task_text}\n\n"
                f"## Верификация\n\n"
                f"Функциональность работает согласно описанию задачи.\n"
            )
            SOLUTION_PATH.write_text(fallback, encoding="utf-8")
            print(f"⚠️ Fallback SOLUTION.md для {next_task_id}")

        return 0

    # ── Normal review flow ──
    if phase == "WAITING":
        print("WAITING phase — nothing to review")
        return 0

    review_prompt = build_review_prompt(phase, context)
    review_content = call_perplexity(review_prompt, solution)
    write_review(phase, round_num, review_content)
    return 0

if __name__ == "__main__":
    sys.exit(main())
