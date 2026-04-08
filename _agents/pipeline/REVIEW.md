# REVIEW от Perplexity — 2026-04-08 04:13 UTC
<!-- phase: ARCHITECTURE | round: 1 -->

# ВЕРДИКТ: CHANGES_NEEDED

## ОЦЕНКА
Логика детерминированного парсинга BACKLOG хороша и решает проблему повторений. Функции `get_next_task_from_backlog()` и `mark_task_done_in_backlog()` правильно структурированы. Переход на PHASE: WAITING при пустом BACKLOG — правильный паттерн.

## ЗАМЕЧАНИЯ

1. **Отсутствует обработка edge case: пустой BACKLOG.md или файл не существует**
   - `get_next_task_from_backlog()` упадёт с FileNotFoundError или IndexError
   - Нужна проверка: `if not os.path.exists(backlog_path)` → return `(None, None)`
   - Если файл пуст → return `(None, None)` вместо краша

2. **`mark_task_done_in_backlog()` ищет задачу по TASK-XX или текстовому совпадению — неоднозначно**
   - Если в BACKLOG два раза встречается похожий текст → может отметить не ту строку
   - Рекомендация: искать ТОЛЬКО по TASK-XX номеру (более надёжно)
   - Если TASK-XX не найден → логировать WARNING, не молчать

3. **Нет валидации формата BACKLOG.md**
   - Если строка `[ ]` содержит невалидный TASK-XX (например, `TASK-ABC`) → функция не должна её брать
   - Нужна regex проверка: `^- \[[ x]\] TASK-\d+:` перед возвратом

4. **Отсутствует откат при ошибке в `mark_task_done_in_backlog()`**
   - Если функция отметила задачу `[x]`, но потом Perplexity API упал → задача потеряна
   - Рекомендация: отмечать `[x]` ПОСЛЕ успешного завершения SOLUTION.md, не до

5. **Не проверяется, что `get_next_task_from_backlog()` вернула валидный TASK-XX**
   - Если парсинг вернул `(None, "текст")` вместо `(None, None)` → workflow продолжит с невалидной задачей
   - Нужна assert: `if task_id is None and task_text is not None: raise ValueError(...)`

6. **Секция "Ожидают credentials" пропускается по строке — хрупко**
   - Если заголовок изменится на "Ожидают учётные данные" → перестанет работать
   - Рекомендация: использовать более гибкий паттерн (regex с `credentials|учётные данные`)

**Действие:** Исправить обработку ошибок, валидацию формата и порядок операций перед деплоем.

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
