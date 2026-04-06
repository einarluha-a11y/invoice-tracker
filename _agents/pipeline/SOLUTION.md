# SOLUTION

PHASE: SETUP
ROUND: 1
TASK: Настроить тихий мониторинг REVIEW.md

## ЗАДАНИЕ — ТОЛЬКО ЭТО

Настрой recurring задачу каждые 30 секунд.

Логика:
1. git fetch origin --quiet 2>/dev/null
2. Прочитать `_agents/pipeline/REVIEW.md` из origin/main
3. Извлечь строку `<!-- phase: X | round: Y -->` из файла
4. Сравнить с `/tmp/.pipeline_state` (формат: `PHASE:ROUND`)
5. Если не изменилось → тишина, ничего не делать
6. Если изменилось → записать новое состояние в `/tmp/.pipeline_state`, затем:
   - Прочитать ВЕРДИКТ из REVIEW.md
   - APPROVED → перейти к следующей фазе по `_agents/workflows/pipeline_protocol.md`
   - CHANGES_NEEDED / CODE_CHANGES_NEEDED → прочитать ЗАМЕЧАНИЯ, исправить, обновить SOLUTION.md (ROUND+1), запушить

Инициализация: если `/tmp/.pipeline_state` нет — создать с текущим состоянием, не реагировать.

Сообщения в окно ТОЛЬКО:
- `📋 Новый ревью: [phase] round [N] — [ВЕРДИКТ]`
- `🔨 Реализую: [описание]`
- `✅ Готово`
- `❌ Ошибка: [что]`

Больше ничего. Никаких отчётов о проверках.
