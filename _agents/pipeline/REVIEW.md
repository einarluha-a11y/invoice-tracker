# REVIEW от Perplexity — 2026-04-08 10:18 UTC
<!-- phase: REVIEW | round: 1 -->

# ВЕРДИКТ
**Нужны изменения в `firestore.rules`** — TASK-01 не покрыл новые пути `accounts/{accountId}/companies/` и `accounts/{accountId}/users/{uid}`.

# ОЦЕНКА
**8/10** — TASK-02 реализован корректно на фронтенде, но security rules отстают от архитектуры.

# ЗАМЕЧАНИЯ

## Проблема
TASK-01 вероятно содержал правила для старых путей (`companies/`, `master_users/`). Новая структура требует явных правил для:
- `accounts/{accountId}/companies/{companyId}` — доступ по роли в `accounts/{accountId}/users/{uid}`
- `accounts/{accountId}/users/{uid}` — чтение своего документа + мастер читает всех

## Что нужно добавить в `firestore.rules`

```firestore
// Мастер может читать/писать любой аккаунт и его компании
match /accounts/{accountId} {
  allow read, write: if request.auth != null && 
    get(/databases/$(database)/documents/master_users/$(request.auth.uid)).data.role == 'master';
  
  // Пользователи аккаунта видят друг друга и компании
  match /users/{userId} {
    allow read: if request.auth != null && 
      (request.auth.uid == userId || 
       get(/databases/$(database)/documents/master_users/$(request.auth.uid)).data.role == 'master');
    allow write: if request.auth != null && request.auth.uid == userId;
  }
  
  match /companies/{companyId} {
    allow read, write: if request.auth != null && 
      (get(/databases/$(database)/documents/accounts/$(accountId)/users/$(request.auth.uid)).data.role in ['admin', 'editor'] ||
       get(/databases/$(database)/documents/master_users/$(request.auth.uid)).data.role == 'master');
  }
}
```

## Действие
1. Обновить `firestore.rules` с правилами выше
2. Задеплоить через Firebase Console
3. Протестировать: мастер видит все аккаунты, юзер видит только свой

**Фронтенд готов к продакшену после этого.**

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
