# Context Log — 2026-04-30-test-hardening

**Feature:** Test Hardening — automated smoke-test + 100% bot interaction coverage
**Branch:** `claude/check-agent-kira-zaaIH`
**Closes:** #59 (production smoke test) + new issue for bot tests
**Pipeline:** PO → Architect → Developer → Reviewer → QA

## Объём (фиксированный, утверждён пользователем)

### Часть A — Smoke test
- `scripts/smoke-test.ts` — read-only HTTP проверки prod
- Покрытие: health endpoints всех модулей + B2C публичные страницы + Telegram bot alive + HTTPS/SSL
- Read-only, без авторизации, без POST
- Output: stdout `[PASS|FAIL]` + Telegram alert при fail
- Триггеры: `npm run smoke` + step в `deploy.yml` после деплоя
- Идемпотентен

### Часть B — Bot interaction tests
- 5 новых файлов в `bot/handlers/__tests__/`: gazebos, ps-park, cafe, my-bookings, link
- 100% branch coverage для соответствующих handlers
- Mock Grammy Context + `vi.mock('@/lib/db')`
- Vitest, без сети, без БД

## Принципы (CLAUDE.md compliance)
- Никаких новых модулей в `src/modules/`
- TypeScript strict, no `any`
- Тесты пишутся вместе с кодом
- CLAUDE.md синхронизировать (отметить #59 done)
- Один PR

## Out of scope
- Issue #60 (мониторинг первой недели)
- Новые фичи бота
- Smoke для admin/RBAC
- Performance/load testing

---

## Stage 1 — PO

(будет заполнено агентом)

## Stage 2 — Architect

(будет заполнено агентом)

## Stage 3 — Developer

(будет заполнено мной)

## Stage 4 — Reviewer

(будет заполнено агентом)

## Stage 5 — QA

(будет заполнено агентом)
