# SOLUTION

PHASE: CODE
ROUND: 1
TASK: Отчёт за 8 апреля — инфраструктура, watchdog, pipeline фиксы

## Выполнено

### Инфраструктура
1. **watchdog.cjs** — независимый PM2 супервизор, проверяет каждые 2 мин
2. **Auto-deploy в pipeline_monitor** — после Claude CLI: git pull + pm2 restart
3. **Watch отключен** для invoice-api/imap — устранён crash loop

### Pipeline фиксы
4. **perplexity_review.py** — детерминированный выбор из BACKLOG
5. **BACKLOG.md** — формат [x]/[ ], git log в промпте
6. **DEPLOY_STATUS regex** — проверка на отдельной строке
7. **Pipeline monitor state** — включает TASK

### PM2 архитектура
```
invoice-api → invoice-imap → pipeline-monitor → watchdog (следит за всеми)
```

### Тесты: 44/44 ✅, syntax 6 файлов ✅, PM2 4/4 online 0 рестартов

DEPLOY_STATUS: OK
