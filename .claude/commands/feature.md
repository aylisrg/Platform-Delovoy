# /feature — фича от задачи до PR

Описание задачи: $ARGUMENTS

Для небольшой задачи (баг, правка в одном модуле) PRD и ADR не нужны — сразу шаги 3–5.

1. **PRD** — субагент `product-owner` пишет `docs/requirements/YYYY-MM-DD-<slug>-prd.md`. Нужен для новой фичи или нового модуля.
2. **ADR** — субагент `system-architect` пишет `docs/architecture/YYYY-MM-DD-<slug>-adr.md`. Нужен, если меняются схема БД, API-контракты или границы модулей.
3. **Реализация** — делаешь сам по правилам CLAUDE.md: код + тесты в одном коммите, `npm test`, `npm run typecheck`, `npm run lint` зелёные; изменения схемы — миграцией.
4. **Ревью** — субагент `code-reviewer`. NEEDS_CHANGES → исправь и повтори (до 3 итераций).
5. **QA** — субагент `qa-engineer` после PASS ревью. FAIL → исправь и повтори.

Итог: ветка `claude/<slug>` или `feature/<module>-<feature>`, PR в `main` с описанием по шаблону. Мержит человек после зелёного CI.
