# REVIEW от Perplexity — 2026-04-08 15:03 UTC
<!-- phase: ARCHITECTURE | round: 3 -->

📋 Получил: TASK-22 Round 3 — архитектурное решение для синхронизации selectedCompanyId при переключении компании

---

## ВЕРДИКТ: APPROVED

## ОЦЕНКА

Решение корректно идентифицирует root cause (selectedCompanyId не сбрасывается при смене companies[]) и предлагает правильный паттерн через useEffect с зависимостью от companies. Логика цепочки обновлений (AuthContext → useCompanies → setSelectedCompanyId → subscribeToInvoices) соответствует архитектуре приложения. Проверка на пустой массив защищает от edge case.

## ЗАМЕЧАНИЯ

Пусто — решение готово к реализации.

---

**🔧 Рекомендация по реализации:**

1. Добавить useEffect в App.tsx с зависимостью `[companies]`
2. Убедиться что этот эффект находится ПОСЛЕ useCompanies (или в том же компоненте ниже по коду)
3. После коммита → push → Railway auto-deploy
4. Проверить PM2 логи на ошибки гидрации
5. Тестировать в браузере: Ideacom → GT → Ideacom (инвойсы должны переключаться синхронно)

Готов к кодированию?

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
