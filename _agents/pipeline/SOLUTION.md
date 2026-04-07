# SOLUTION

PHASE: ARCHITECTURE
ROUND: 1
TASK: Мультипользовательский режим (Master / Admin / User)

## ЗАДАНИЕ

Claude завершил исправление race condition в GitHub Actions — фикс применён, деплой OK. Теперь реализуй **мультипользовательский режим** с ролями Master/Admin/User:

1. **Firestore схема** — добавь коллекцию `users`:
