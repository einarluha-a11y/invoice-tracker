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

def build_next_task_prompt(context: str, backlog: str, completed_task: str) -> str:
    context_trimmed = context[:4000]
    backlog_trimmed = backlog[:3000] if backlog else "Нет бэклога — выбери следующую задачу из анализа кода."
    return (
        "Ты — технический менеджер проекта Invoice-Tracker. "
        "Claude только что завершил задачу. Тебе нужно:\n\n"
        "1. Кратко оценить выполненную работу (2-3 предложения)\n"
        "2. Выбрать СЛЕДУЮЩУЮ задачу из бэклога (или предложить свою на основе анализа кода)\n"
        "3. Написать SOLUTION.md с новым заданием для Claude\n\n"
        "ФОРМАТ ОТВЕТА — точно этот markdown:\n\n"
        "```solution\n"
        "# SOLUTION\n\n"
        "PHASE: ARCHITECTURE\n"
        "ROUND: 1\n"
        "TASK: [одна строка — суть задачи]\n\n"
        "## ЗАДАНИЕ\n\n"
        "[Подробное описание что Claude должен сделать]\n\n"
        "## Верификация\n"
        "[Как проверить что задание выполнено]\n"
        "```\n\n"
        f"Бэклог задач:\n{backlog_trimmed}\n\n"
        f"Завершённая задача:\n{completed_task[:2000]}\n\n"
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

        # Step 2: Generate next task
        backlog = read_file(BACKLOG_PATH)
        next_task_prompt = build_next_task_prompt(context, backlog, solution)
        next_task_content = call_perplexity(next_task_prompt, solution, max_tokens=3000)

        if write_solution(next_task_content):
            print("✅ Next task generated and written to SOLUTION.md")
        else:
            # Fallback: write WAITING state
            SOLUTION_PATH.write_text(
                "# SOLUTION\n\nPHASE: WAITING\nROUND: 0\n"
                "TASK: (ожидаю следующее задание — Perplexity не смог сгенерировать)\n",
                encoding="utf-8"
            )
            print("⚠️ Fallback: SOLUTION.md set to WAITING")

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
