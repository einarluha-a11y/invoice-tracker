#!/usr/bin/env python3
"""
Perplexity Review — GitHub Actions entry point.

Reads _agents/pipeline/SOLUTION.md, determines phase, calls Perplexity API,
writes _agents/pipeline/REVIEW.md.
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

def build_system_prompt(phase: str, context: str) -> str:
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

def call_perplexity(system_prompt: str, user_content: str) -> str:
    payload = {
        "model": "sonar-pro",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "max_tokens": 2048,
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
    except (KeyError, IndexError) as e:
        print(f"ERROR: unexpected Perplexity response: {data}", file=sys.stderr)
        sys.exit(1)

def main() -> int:
    solution = read_file(SOLUTION_PATH)
    if not solution:
        print("ERROR: SOLUTION.md not found or empty", file=sys.stderr)
        return 1

    phase = extract_field(solution, "PHASE", "UNKNOWN")
    round_num = extract_field(solution, "ROUND", "1")
    print(f"Phase: {phase}, Round: {round_num}")

    # Skip review if Claude already marked task as complete
    if "DEPLOY_STATUS: OK" in solution and phase not in ("WAITING",):
        print("DEPLOY_STATUS: OK detected — task complete, skipping review. Waiting for next task from Einar.")
        return 0

    charter = read_file(CHARTER_PATH)
    claude_md = read_file(CLAUDE_MD_PATH)
    context = f"{claude_md}\n\n{charter}"

    system_prompt = build_system_prompt(phase, context)
    content = call_perplexity(system_prompt, solution)

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
    return 0

if __name__ == "__main__":
    sys.exit(main())
