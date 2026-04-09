# SOLUTION

PHASE: WAITING
ROUND: 2
DEPLOY_STATUS: OK
TASK: audit-paid — аудит Paid инвойсов после стабилизации IMAP

## РЕЗУЛЬТАТ АУДИТА

`node repairman_agent.cjs --audit-paid --fix`

- **Checked**: 142 инвойса со статусом Paid
- **OK**: 52 — корректно совпадают (ref + vendor)
- **Reverted**: 22 — ложные совпадения, возвращены в прежний статус
- **No bank link**: 68 — Paid без банковской привязки (ручные оплаты)

## REVERTED (22 инвойса)

Ложные совпадения — банковская транзакция привязана неверно (только vendorOk=true, refOk=false или наоборот).

Примеры:
- Konica Minolta: ref не совпадал (EES047921 vs Arve EES045811)
- LHV / 119294475: ref частичный (119294473)
- Wellcargo: ref "INVOICE nr 26-02" vs tx reference
- OMEGALAEN / 260399844: vendor не совпал (cp=Omega Laen AS)

## ПРЕДЫДУЩИЙ BUGFIX

`automation/imap_listener.cjs` — IMAP crash loop исправлен:
- `b703a72` — persist rate limits to disk
- `68b7630` — stop crash loop on too-many-connections
