# QA-отчёт: Issue #591 — /admin/* страницы отдавали контент без авторизации (обход RBAC через proxy.ts)

## Вердикт: PASS

## Контекст
- Ветка: `claude/issue-591-admin-rbac-bypass`, коммит `1991616` (HEAD) поверх `main`.
- Root cause: `next-auth@5.0.0-beta.31`'s `handleAuth()` уважает возврат `authorized()`
  callback только если это `instanceof Response` — bare `boolean` молча отбрасывается,
  когда в `auth()` передана кастомная middleware-функция (`src/proxy.ts` делает это
  всегда, ради staging-гейтов). Два deny-пути для `/admin/*` в `src/lib/auth.config.ts`
  возвращали `return false` — без сессии и с ролью USER. Из-за бага это не давало
  никакого эффекта: запрос долетал до страницы.
- Фикс: оба пути теперь `Response.redirect(...)` — на `/auth/signin?callbackUrl=...`
  (нет сессии) и на `/admin/forbidden` (роль USER) — которые next-auth уважает.
- `git diff main HEAD --stat`: 2 файла, `+71/-2` — `src/lib/auth.config.ts` (сама
  правка, +12/-2) и `src/lib/__tests__/auth.config.test.ts` (5 новых unit-тестов,
  +54). Вне этого — пусто, скоуп-крипа нет. PRD в `docs/requirements/` отсутствует —
  точечный security-фикс, эталон — сам баг-репорт issue #591 и уже одобренный
  паттерн соседней ветки (ADMIN/MANAGER wrong-section), которая уже возвращала
  `Response.redirect` и поэтому не была затронута багом.
- `docs/qa-reports/591-*-review.md` на момент проверки не найден в `docs/qa-reports/`
  (только `issue-557/574/576/622`) — прочитан diff и коммит-сообщение напрямую.

## Прочитан diff вручную
`src/lib/auth.config.ts`: подтверждено, что оба deny-пути (`!auth?.user` и
финальный `// USER role — no admin access`) заменены с `return false` на
`Response.redirect`. Соседняя ветка ADMIN/MANAGER wrong-section (строка с
`if (!adminSections.includes(section))`) уже использовала `Response.redirect` —
не тронута, поведение не меняется. `src/proxy.ts` подтверждён: `auth(async
(request) => {...})` — именно тот паттерн (custom middleware function), который
триггерит баг в next-auth.

## Регрессия
- `npm test -- --run`: **268 test files passed (268), 3807 tests passed (3807)**,
  0 failed (5 новых тестов из диффа входят в счёт).
- `npx tsc --noEmit`: чисто, пустой вывод.
- `npm run lint`: **0 errors, 16 warnings** — все pre-existing, в несвязанных
  файлах (`messenger/*`, `notifications/service.ts`, `telephony/novofon-client.ts`
  и т.д.), ни один не в `src/lib/auth.config.ts` или его тестах.

## Живая black-box проверка (собранный standalone-сервер, реальные Postgres/Redis)
Собрано `npm run build:e2e` (env: `DATABASE_URL`, `REDIS_URL=localhost:6379`,
`NEXTAUTH_URL/SECRET`, `AUTH_SECRET`) и запущено `node .next/standalone/server.js`
(+ `AUTH_TRUST_HOST=true`, `PORT=3000`) с нуля из HEAD-коммита (на порту 3000
изначально висел чужой процесс — убит через `fuser -k 3000/tcp`, поднят
собственный сервер, чтобы не полагаться на чужую сборку).

| # | AC (из issue) | Ожидание | Наблюдение | Статус |
|---|---|---|---|---|
| a | `GET /admin/dashboard`, **zero cookies** | НЕ 200, редирект к signin | `HTTP 302`, `Location: /auth/signin?callbackUrl=http%3A%2F%2Flocalhost%3A3000%2Fadmin%2Fdashboard`, тело редиректа — 95 байт (без контента страницы) | PASS |
| b1 | `user@local` (USER) → `/admin/dashboard` | НЕ 200, редирект на forbidden | `HTTP 302` → `/admin/forbidden` | PASS |
| b2 | `user@local` (USER) → `/admin/users` | НЕ 200, редирект на forbidden | `HTTP 302` → `/admin/forbidden`, тело — просто ссылка, без данных пользователей | PASS |
| b3 | `user@local` (USER) → `/admin/gazebos/bookings` | НЕ 200, редирект на forbidden | `HTTP 302` → `/admin/forbidden`, тело — 37 байт, без данных броней | PASS |
| c1-3 | `admin@local` (SUPERADMIN) → те же 3 страницы | **200, без ложной блокировки** | Все три `HTTP 200` (подтверждена сессия: `role: SUPERADMIN` через `/api/auth/session`) | PASS |
| d1 | `/api/admin/badge-counts`, USER-сессия (control) | 403, не затронут фиксом | `HTTP 403 {"success":false,"error":{"code":"FORBIDDEN",...}}` — как и до фикса | PASS |
| d2 | `/api/admin/badge-counts`, SUPERADMIN-сессия (control) | 200, не затронут фиксом | `HTTP 200 {"success":true,"data":{...}}` | PASS |
| d3 | `/api/admin/badge-counts`, zero cookies (control) | 401, не затронут фиксом | `HTTP 401` | PASS |

Логин выполнен по официальному credentials-флоу (`GET /api/auth/csrf` →
`POST /api/auth/callback/credentials` с `csrfToken`), не заглушкой — сессионные
cookies (`authjs.session-token`) реальные, идентичность подтверждена через
`GET /api/auth/session` перед каждым блоком проверок.

Сервер остановлен (`fuser -k 3000/tcp`) по завершении проверки.

## Security-чеклист (функциональный)
- [x] Анонимный запрос к `/admin/*` → редирект (не 200, не утечка контента).
- [x] USER-роль → `/admin/forbidden` (не 403 JSON, но и не доступ к странице —
  корректное поведение для SSR-страницы, соответствует уже существующему
  паттерну для wrong-section у ADMIN/MANAGER).
- [x] SUPERADMIN не заблокирован фиксом (проверено на 3 разных `/admin/*` роутах +
  на control API) — критично, т.к. фикс, ломающий легитимный доступ, хуже бага.
- [x] `/api/admin/*` (JSON API, contol-группа) не затронут — 401/403/200 идентичны
  ожидаемому поведению до фикса на всех трёх ролях.
- [x] Тело редиректа не содержит данных страницы (95 / 37 байт — только служебный
  HTML с ссылкой на Location, не дашборд/список пользователей/список броней).

Security-блокеров нет.

## Scope check
Изменения строго в рамках issue #591: 1 файл логики (`auth.config.ts`, +12/-2
строки в двух deny-путях) + его тесты. `package.json`, `prisma/schema.prisma`,
`CLAUDE.md`, `src/proxy.ts` не тронуты.

## Итог
- Всего AC (из акцептанс-критериев issue): 8 (a, b1-b3, c1-c3 объединены, d1-d3)
- PASS: 8, FAIL: 0
- `npm test` (268/268 файлов, 3807/3807 тестов), `tsc --noEmit`, `eslint` — чисто
- Живой репро на собранном standalone-сервере с реальными Postgres/Redis
  подтверждает: анонимный и USER-доступ к `/admin/*` больше не отдают 200/контент,
  SUPERADMIN не регрессирует, JSON API control-группа не затронута
- Original repro из issue #591 (`curl /admin/dashboard` без cookies → 200) —
  **больше не воспроизводится**

**Вердикт: PASS.** Фикс устраняет P0-дыру именно в том месте, где она была
(SSR `/admin/*` через `authorized()` callback, а не API-слой), не создаёт
ложной блокировки для SUPERADMIN, не затрагивает уже корректно работавшие
контрольные точки. Проверено независимо от unit-тестов — черным ящиком на
реальном собранном сервере с реальной БД, ровно по репродукции из
оригинального баг-репорта.
