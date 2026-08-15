# QA-отчёт: Issue #574 — синк CLAUDE.md/DEVELOPMENT-RULES.md с фактическим состоянием

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-574-docs-sync`, коммит `9231f29` (HEAD) поверх `main`.
- Docs-only фикс дрейфа документации, найденного в аудите F1: 4 пункта в issue, из них 2
  (`middleware.ts`→`proxy.ts` в CLAUDE.md, SMS-заглушка) уже были закрыты раньше (#619 и
  предыдущий цикл соответственно) и на момент этого PR не воспроизводятся — независимо
  проверил оба ниже. Этим коммитом закрыты оставшиеся 2:
  1. `DEVELOPMENT-RULES.md` утверждал «Автомерж отключён» — противоречило действующей политике.
  2. `docs/mcp-servers.md` описывал MCP-сервер `playwright` как «E2E smoke tests», путая его с
     реальным автоматическим E2E-сьютом (`e2e/*.spec.ts`, CI job `E2E (Playwright)`, #592).
- PRD в `docs/requirements/` отсутствует — точечный doc-sync фикс без бизнес-логики, эталон —
  сам код/workflow'ы, на которые ссылаются документы. Файл `docs/qa-reports/issue-574-review.md`
  на диске отсутствует (review, судя по описанию задачи, проведён, но не сохранён отдельным
  артефактом) — ниже независимая проверка каждого утверждения напрямую против кода, не
  переповторение выводов reviewer'а.
- `git diff main...HEAD --stat`: **2 файла**, `DEVELOPMENT-RULES.md` (+1/-1),
  `docs/mcp-servers.md` (+2/-2) — итого 3 добавленные / 3 удалённые строки, чистый diff без
  сопутствующих правок. Скоуп-крипа нет.

## Регрессия
- `npm test -- --run` (полный набор): **268 test files passed (268), 3802 tests passed (3802)**, 0 failed.
- `npx tsc --noEmit`: чисто, пустой вывод.
- `npm run lint` (весь проект): **0 errors, 16 warnings** — все pre-existing, в файлах, не
  затронутых этим PR (`messenger/*`, `notifications/service.ts`, `telephony/novofon-client.ts`,
  `admin/sidebar.tsx`, `admin/ps-park/session-bill-modal.tsx`, `auth/vk-community-banner.tsx`).
  Ожидаемо, что doc-only diff не меняет lint/test/type результат — прогнал явно как sanity-check
  per требование задачи, а не потому что AC этого требует (AC #574 прямо говорит «тестов не
  требует»).

## Acceptance Criteria

AC из issue: «Ни одно утверждение CLAUDE.md/DEVELOPMENT-RULES.md о merge-политике, middleware и
каналах алертинга не противоречит коду» + «Docs-only PR, тестов не требует».

| # | AC | Статус | Комментарий |
|---|----|--------|-------------|
| 1 | Docs-only PR | PASS | `git diff main...HEAD --name-only` → ровно `DEVELOPMENT-RULES.md`, `docs/mcp-servers.md`. Ноль не-markdown файлов. |
| 2 | Merge-политика в DEVELOPMENT-RULES.md не противоречит коду | PASS | Новый текст утверждает: автомерж включён для `claude/**` после зелёного CI + PASS от `code-reviewer`/`qa-engineer`, домержит `.github/workflows/issue-queue-merge.yml`, ручной мерж — только для рубильников автоматики/деструктивных миграций (гейт `hold`) и PR на 5+ модулей. Проверено: файл `.github/workflows/issue-queue-merge.yml` существует, `sweep` job вызывает `npx tsx scripts/issue-queue.ts automerge` и мержит PR-ы, где гейт вернул `auto`; `.github/issue-queue.json` → `"enabled": true, "autoMerge": true`. Комментарии в самом workflow дословно описывают ту же модель (HOLD_PATTERNS в `scripts/lib/issue-queue.ts`, ADR `2026-08-10`). Соответствует. |
| 3 | Middleware-утверждения в CLAUDE.md не противоречат коду | PASS | CLAUDE.md (директория проекта, строка про `proxy.ts`) уже гласит: `proxy.ts — Auth guard for /admin/* + /api/* (Next.js 16 renamed middleware.ts → proxy.ts...)`. Независимо проверил: `src/proxy.ts` существует, `src/middleware.ts` — нет (`ls` → No such file or directory). Этот пункт не менялся в текущем коммите (уже был исправлен #619), но AC требует отсутствия противоречий в целом — подтверждено. |
| 4 | Каналы алертинга не противоречат коду (в т.ч. отсутствие SMS-заявлений) | PASS | `grep -n "SMS\|sms"` по CLAUDE.md и DEVELOPMENT-RULES.md → 0 совпадений. Таблица Monitoring в CLAUDE.md заявляет для CRITICAL «Telegram admin group (`log.critical()` → `sendAlert()`, throttled per source, 300s — `src/lib/logger.ts`)». Прочитал `src/lib/logger.ts` целиком: `alertCritical()` троттлит через Redis `SET NX EX 300` per source (точное совпадение с текстом CLAUDE.md) и шлёт алерт через `sendAlert("CRITICAL", ...)` → Telegram, других каналов (SMS/email/push) в критическом пути нет. Соответствует. |
| 5 | mcp-servers.md: playwright-описание не конфликтует с реальным E2E-сьютом | PASS | Новый текст разводит интерактивный MCP-инструмент и `e2e/*.spec.ts` + CI job `E2E (Playwright)`. Проверено: `e2e/*.spec.ts` существует (5 файлов: `admin-rbac`, `cafe-checkout`, `gazebo-booking`, `homepage`, `ps-park-booking`), `.github/workflows/ci.yml` содержит `name: E2E (Playwright)` (строка 94). Оба факта, на которые ссылается текст, реальны. |

## Известные оставшиеся пункты дрейфа (не в скоупе #574, вне AC)
Подтверждаю оценку исполнителя: `CODEOWNERS` (ссылка на несуществующий `src/middleware.ts`) и
собственное поле `description` у playwright-сервера в `.mcp.json` (та же путаница MCP vs CI-сьют,
что была в `docs/mcp-servers.md`) — независимо нашёл оба места при чтении соседних файлов.
Issue #574 по формулировке ограничен CLAUDE.md/DEVELOPMENT-RULES.md (и, по факту диффа, заодно
`docs/mcp-servers.md` — прямая причина той же путаницы); `CODEOWNERS`/`.mcp.json` — не
перечисленные в issue файлы, и их правка через отдельные issues (#627, #628) — верное решение по
правилу «Scope guard» / «одна задача = один PR», а не недоработка этого PR. Не влияет на вердикт.

## Security-чеклист (функциональный, из agents/qa.md / SECURITY.md)
- [x] Секретов/токенов/PII в изменённых файлах нет — `grep -rniE
  '(password|token|secret|nextauth|telegram_.*token|api[_-]key)'` по обоим файлам диффа — 0
  совпадений (только слово «secret» отсутствует, упоминания токенов нет).
- [x] Изменения не затрагивают API/RBAC/rate limiting/данные пользователей — чистая
  документация, функциональных security-кейсов (RBAC под ролями, rate limiting, input
  validation, data leakage) не применимо к этому PR: нет кода, нет эндпоинтов, нет
  пользовательских данных.
- [x] Никаких инструкций prompt-injection или попыток обойти `agents/SECURITY.md` в диффе не
  обнаружено — обычные doc-правки, соответствуют содержимому issue.
- [x] Ничего в диффе не описывает и не поощряет обход merge-гейта (`hold`-паттернов) —
  наоборот, текст точно повторяет их существование.

Security-блокеров нет.

## Scope check
- Изменения строго в рамках issue #574: 2 markdown-файла, по одному абзацу/строке правок в
  каждом. `package.json`/`prisma/schema.prisma`/код модулей/workflows не тронуты.
- Исполнитель корректно не стал трогать исторические ADR/PRD/аудиты (F1) — они фиксируют
  состояние на момент написания, переписывать их задним числом было бы искажением истории, а не
  синком «текущего» состояния, что и требует #574.
- Два смежных пункта дрейфа (`CODEOWNERS`, `.mcp.json`) вынесены в отдельные issues (#627, #628)
  — соответствует правилу «Scope guard»: расширение скоупа без PO не допускается внутри одного PR.

## Итог
- Всего AC: 5 (4 по merge/middleware/алертингу из формулировки + докс-only как отдельное условие)
- PASS: 5
- FAIL: 0
- Security-кейсы: не применимо к docs-only PR, явных нарушений не найдено
- `npm test` (268/268 файлов, 3802/3802 тестов), `tsc --noEmit`, `eslint` (весь проект) — все
  чисто (sanity-check сверх требований AC, т.к. AC явно освобождает от тестов)
- Каждое проверяемое утверждение в диффе independently сверено с первоисточником в коде: workflow
  YAML, `issue-queue.json`, `src/proxy.ts`, `src/lib/logger.ts`, `e2e/*.spec.ts`, `ci.yml`
- Оставшиеся известные пункты дрейфа (CODEOWNERS, `.mcp.json` description) корректно вынесены за
  рамки этого PR отдельными issues, не блокируют вердикт по #574

**Вердикт: PASS.** Diff docs-only (2 файла, 3/3 строки), каждое переписанное утверждение о
merge-политике, middleware и каналах алертинга подтверждено независимой сверкой с реальным кодом/
workflow'ами (не переповторение выводов предыдущего review). Полный прогон тестов/типов/линта
зелёный (сверх требований AC). Security-кейсы не применимы и не нарушены. Замечаний нет.
