# QA-отчёт: PR #790 — fix(auth): exempt /api/admin/owner-decisions from NextAuth session gate

**Branch:** `claude/owner-decisions-timeout-kmq9bb` → `main`
**Commit проверен:** `c1177aa`
**code-reviewer:** PASS (задача — независимая функциональная верификация, не повторное ревью кода)

## Скоуп

CRITICAL-алерт: контур owner-decisions (Telegram-кнопки решений владельца) ни
разу не прислал heartbeat. Root cause подтверждён живыми логами GitHub
Actions: `issue-queue-merge.yml` дёргает `GET /api/admin/owner-decisions` с
`Authorization: Bearer $OWNER_DECISIONS_SECRET`, без cookie сессии — и
получал `401 {"code":"UNAUTHORIZED","message":"Необходимо войти в аккаунт"}`.
Это сообщение генерирует глобальный `authorized()` в `src/lib/auth.config.ts`
(требует реальную сессию для любого `/api/admin/*`), а не собственная
Bearer-проверка роута (`checkSecret()` в `route.ts`, которая при неверном
секрете отвечает `"Invalid owner-decisions secret"`). Секрет был настроен
верно — но сессионный гейт отбивал запрос раньше, чем роут успевал его
проверить.

Фикс: точный allowlist `isOwnerDecisionsRoute` (строгое совпадение
`pathname === "/api/admin/owner-decisions"`, без учёта метода) в
`authorized()`, по образцу уже существующего `isCiWebhook` для
`/api/admin/release-notify`. Собственная защита роута (`checkSecret()`) не
тронута.

Диффа по коду ровно 2 файла: `src/lib/auth.config.ts` (+5) и
`src/lib/__tests__/auth.config.test.ts` (+23, тесты самого PR).

PRD на этот фикс не заводился (инцидент-хотфикс, не фича) — acceptance
criteria взяты из задачи на верификацию.

## Изоляция диффа

```
$ git diff main...HEAD --stat
 src/lib/__tests__/auth.config.test.ts | 23 +++++++++++++++++++++++
 src/lib/auth.config.ts                |  5 +++++
 2 files changed, 28 insertions(+)
```

Прикладной код изменён только в `authorized()`: добавлена константа
`isOwnerDecisionsRoute` и строка `if (isOwnerDecisionsRoute) return true;`
сразу после существующей проверки `isCiWebhook`. Собственная логика роута
(`route.ts`, `checkSecret()`, `safeEqual()`) в диффе не участвует —
подтверждено `git diff main...HEAD -- src/app/api/admin/owner-decisions/route.ts`
(пусто).

## Методология

По требованию задачи не ограничился перечиткой PR-тестов. Написал и запустил
собственный независимый файл `src/lib/__tests__/qa-independent-owner-decisions.test.ts`
(12 тестов), вызывающий `authConfig.callbacks.authorized()` и сам route
handler (`GET` из `route.ts`) напрямую — теми же приёмами, что уже
используются в `auth.config.test.ts` / `auth-config.test.ts`, но
переписанными с нуля (собственные хелперы `makeRequest`/`callAuthorized`,
свои сценарии, включая метод `DELETE`, который не покрыт тестами самого PR,
и look-alike путь `/api/admin/owner-decisionsX` без слэша). После прогона
файл удалён — это разовая проверочная утварь, не часть поставки PR.

## Результаты по acceptance criteria

### AC-1: Анонимные GET/POST/PATCH на `/api/admin/owner-decisions` проходят сессионный гейт

**PASS.** Независимый тест напрямую вызывает `authorized({auth: null, request})`
для всех трёх методов плюс `DELETE` (не покрыт тестами PR — `isOwnerDecisionsRoute`
не фильтрует по методу, поэтому любой метод на точном пути должен пройти):

```
✓ QA independent verification — AC1: anonymous requests reach the route handler
  ✓ GET /api/admin/owner-decisions anonymous, no Authorization header -> not session-blocked (true)
  ✓ POST /api/admin/owner-decisions anonymous, no Authorization header -> not session-blocked (true)
  ✓ PATCH /api/admin/owner-decisions anonymous, no Authorization header -> not session-blocked (true)
  ✓ DELETE /api/admin/owner-decisions (unlisted method, still exact path match) -> not session-blocked (true)
```

Все четыре вызова вернули `true` (не `Response` с 401) — запрос доходит до
хендлера роута. Дальше проверено (AC-3), что хендлер сам отбивает его
отдельной причиной (`checkSecret()`), а не сессионным гейтом — именно то
поведение, которое требовалось.

### AC-2: Bypass узко ограничен — не расширяется на соседние пути

**PASS.** Проверены четыре сценария расширения периметра:

```
✓ QA independent verification — AC2: bypass does not widen to siblings or other /api/admin/* routes
  ✓ GET /api/admin/owner-decisions/other -> still session-gated (401 Response, not boolean true)
  ✓ GET /api/admin/owner-decisionsX (prefix look-alike, no slash) -> still session-gated
  ✓ GET /api/admin/users -> still session-gated (401 Response)
  ✓ GET /api/admin -> still session-gated (401 Response)
  ✓ regression sanity — authenticated USER role hitting /api/admin/users still gets 403 (unaffected by this PR's change)
```

`/api/admin/owner-decisions/other` и look-alike `/api/admin/owner-decisionsX`
(без слэша, теста на этот конкретный кейс в PR нет) корректно остаются за
сессией — `isOwnerDecisionsRoute` использует строгое `===`, а не `startsWith`,
поэтому не матчит ни вложенные пути, ни префиксные тёзки. `/api/admin/users`
и `/api/admin` (голый) не задеты вовсе. Последний тест — регрессионная
сверка, что ветка проверки роли для `/api/admin/*` (`role !== SUPERADMIN &&
role !== ADMIN && role !== MANAGER` → 403) физически не изменена этим PR:
идентична на `main` (`git show main:src/lib/auth.config.ts` — тот же код),
диффом не тронута.

### AC-3: Собственная проверка секрета роута (`checkSecret()`) не тронута

**PASS.** Диффом файл `route.ts` не затронут (`git diff` для него пуст).
Независимо от этого вызвал реальный экспортированный `GET` из
`route.ts` (не мок) с разными состояниями env/заголовка:

```
✓ QA independent verification — AC3: route's own checkSecret() is untouched
  ✓ 503 NOT_CONFIGURED when OWNER_DECISIONS_SECRET is unset
  ✓ 401 UNAUTHORIZED with a valid-format-but-wrong Bearer token
  ✓ 401 UNAUTHORIZED with missing Authorization header entirely
```

- `OWNER_DECISIONS_SECRET` не задан → `503`, `code: "NOT_CONFIGURED"`.
- Секрет задан, заголовок с неверным значением → `401`,
  `code: "UNAUTHORIZED"`, `message: "Invalid owner-decisions secret"`
  (именно та фраза, что отличает эту ошибку от сессионного 401 из
  `auth.config.ts` — подтверждает, что запрос действительно добрался до
  роута, а не был отбит раньше).
- Заголовок отсутствует вовсе → `401` (пустая строка не проходит
  `timingSafeEqual` сравнение с `Bearer <secret>`).

Логика `checkSecret()`/`safeEqual()` — timing-safe `Buffer` compare,
поведение не изменилось.

### AC-4: Нет регрессии в других роутах — полный набор тестов

**PASS.**

```
$ npm test -- --run
 Test Files  318 passed (318)
      Tests  4431 passed (4431)
   Duration  44.47s
```

Включая оба существующих auth-конфиг файла целиком:

```
$ npx vitest run src/lib/__tests__/auth.config.test.ts src/lib/__tests__/auth-config.test.ts
 Test Files  2 passed (2)
      Tests  54 passed (54)
```

Плюс собственный независимый файл — 12/12 (см. выше), удалён после прогона
(не часть поставки, тестовая утварь для верификации). Регрессий по
`/api/gazebos/*`, `/api/ps-park/*`, `/api/cafe/checkout`, `/api/payments/*`,
`/admin/*` — не найдено, все существующие ассерты (allowlist #527,
guest-checkout, платёжный контур) прошли без изменений.

### AC-5: `npm test`, `npx tsc --noEmit`, `npm run lint` чистые

**PASS.**

```
$ npx tsc --noEmit
(без вывода — 0 ошибок)

$ npm run lint
✖ 21 problems (0 errors, 21 warnings)
```

0 errors — требование выполнено. 21 warning — все в файлах, не относящихся
к этому PR (`components/admin/mobile-nav.tsx`, `session-bill-modal.tsx`,
`print-day-sheet.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`,
`ChatWindow.tsx`, `MessageBubble.tsx`, `useChatList.ts`,
`modules/messenger/types.ts`, `modules/notifications/service.ts`,
`modules/telephony/novofon-client.ts`) — ни `auth.config.ts`, ни
`route.ts`, ни тестовые файлы этого PR среди них не фигурируют.
Предсуществующие, не регрессия этого PR.

## Security-чеклист (функциональный)

- **RBAC**: анонимный запрос к `/api/admin/owner-decisions` больше не
  получает "залогинься" — получает предметный `401`/`503` от собственной
  проверки роута. Соседние `/api/admin/*` (включая `/api/admin/users`)
  по-прежнему требуют сессию — PASS (AC-2 выше).
- **Прямая подмена периметра bypass'а**: строгое `===` вместо `startsWith`
  исключает обход через вложенные/префиксные пути — PASS.
- **Секрет-аутентификация роута**: `timingSafeEqual`, `503` fail-secure при
  отсутствии секрета в env, не логирует сам секрет — не изменено этим PR,
  подтверждено прямым вызовом — PASS.
- **Data leakage**: тела ошибок (`503`/`401`) содержат только `code`/`message`,
  без stack trace и путей файлов — PASS.
- **Rate limiting**: эндпоинт админский (CI-triggered), под общее правило
  "Admin: no limit" из CLAUDE.md — не применимо, не регрессия.

Ни один security-кейс не провален.

## Итог

| AC | Результат |
|----|-----------|
| AC-1: анонимные запросы проходят сессионный гейт | PASS |
| AC-2: bypass узко ограничен (не расширяется на соседей) | PASS |
| AC-3: `checkSecret()` роута не тронут | PASS |
| AC-4: полный набор тестов зелёный, регрессий нет | PASS |
| AC-5: `npm test` / `tsc --noEmit` / `lint` чистые | PASS |

## Вердикт: PASS
