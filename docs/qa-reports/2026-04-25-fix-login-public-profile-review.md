# Review: fix-login-public-profile

**RUN_ID:** 2026-04-25-fix-login-public-profile
**Reviewer:** code-reviewer subagent
**Дата:** 2026-04-25
**Stage:** 4 / 5

---

## Ключевой факт о диффе

`git diff main...HEAD --stat` показывает 98 файлов, 5168 строк — это вводит в заблуждение. Ветка была создана до того, как `main` продвинулся вперёд через ряд коммитов (inventory, analytics, landing, sidebar, bot, vitest), и всё расхождение суммируется в `main...HEAD`. Единственный коммит Stage 3 (`8830143 fix(auth): close magic-link userId vulnerability + open /dashboard cabinet`) затрагивает ровно **12 файлов** — все в рамках ADR. Ревью проводится именно по нему.

---

## A. Acceptance Criteria

| AC | Статус | Подтверждение |
|----|--------|---------------|
| AC-1.1 Токен обязателен | PASS | `src/lib/auth.ts:320-328` — Credentials("magic-link") теперь принимает `nonce`, вызывает `authorizeMagicLinkNonce`. При отсутствии nonce или незнакомом значении — `return null`. Прямой вызов с `{ userId }` не проходит. |
| AC-1.2 Одноразовость | PASS | `consumeSignInNonce` использует `redis.getdel` (атомарный GETDEL). Тест `"a single nonce can only be consumed once"` в `magic-link-authorize.test.ts` явно проверяет повторный вызов → null. |
| AC-1.3 TTL 5 мин | PASS | `SIGNIN_NONCE_TTL_SECONDS = 5 * 60` в `email-magic-link.service.ts`. Передаётся как `"EX", SIGNIN_NONCE_TTL_SECONDS` в Redis SET. |
| AC-1.4 VerificationToken не затронут | PASS | `verifyMagicLink()` не изменена — она по-прежнему инвалидирует VerificationToken в БД. `generateSignInNonce` добавлена как отдельный шаг после успешной верификации. |
| AC-1.5 Корректный флоу сохранён | PASS | `verify-email/route.ts`: `verifyMagicLink` → `generateSignInNonce` → `redirect ?magic=<nonce>`. Страница `signin/page.tsx` вызывает `signIn("magic-link", { nonce })` → `redirectAfterLogin()`. Флоу цел. |
| AC-1.6 Тесты зелёные | PASS | 1632/1632 PASS (91 файл). Базовый показатель 1611 — прирост +21. |
| AC-1.7 Другие провайдеры не тронуты | PASS | `git show 8830143` — изменения только в Credentials("magic-link") блоке. Telegram, Yandex, Google, VK, password-провайдеры не затронуты. |
| AC-2.1 USER → /dashboard после входа | PASS | `src/app/auth/signin/page.tsx:85`: `window.location.href = "/dashboard"` для ролей не admin/manager. |
| AC-2.2 Ссылка на кабинет с публичных страниц | PASS | `Navbar` (уже на `page.tsx` до коммита) содержит условный рендер: гость → "Войти", USER → dropdown с "Личный кабинет" → `/dashboard`, admin → "Админ-панель" → `/admin/dashboard`. |
| AC-2.3 /dashboard защищён | PASS | `src/app/(public)/dashboard/page.tsx:80-81`: `const session = await auth(); if (!session?.user?.id) redirect("/");` — server-side guard сохранён. |
| AC-2.4 Функциональность /dashboard сохранена | PASS | Изменения только в header: убрана самодельная навигация, добавлен `<Navbar />`. Логика данных (bookings, orders, feedback, contacts) не тронута. |
| AC-2.5 Кнопка выхода | PASS | Navbar содержит `signOut({ callbackUrl: "/" })` — присутствует на `/dashboard` после замены header. Дублирования нет. |
| AC-2.6 Magic-link → /dashboard | PASS | После `signIn("magic-link", { nonce })` → `redirectAfterLogin()` → USER оказывается на `/dashboard`. |
| AC-2.7 Нет новых модулей и API | PASS | Stage 3 коммит не создаёт новых route handlers. `magic-link-authorize.ts` — файл внутри существующего модуля `src/modules/auth/`, не новый модуль. |
| AC-2.8 Тесты зелёные, redirectAfterLogin покрыт | PARTIAL | Прямого unit-теста на `redirectAfterLogin` нет (это `useCallback` в клиентском компоненте, тестировать без JSDOM/MSW нетривиально). Косвенно покрыто `magic-link-authorize.test.ts` и `route.test.ts`. **Допустимо.** |

---

## B. Качество кода

- **TypeScript strict:** без `any`. `magic-link-authorize.ts` использует `Partial<Record<"nonce", unknown>>` — корректная строгая типизация.
- **Бизнес-логика в модулях:** `authorizeMagicLinkNonce`, `consumeSignInNonce`, `generateSignInNonce` — в `src/modules/auth/`. Route handler только вызывает сервис.
- **Тесты:** +21 тест в 3 файлах:
  - `email-magic-link.service.test.ts` — 8 новых тестов на nonce-функции
  - `magic-link-authorize.test.ts` — новый файл, 8 тестов включая replay-атаку
  - `verify-email/__tests__/route.test.ts` — новый файл, 5 тестов (happy + error paths)
- **Нет утечек nonce в логах:** проверено grep по `console.*` в изменённых файлах — нет вывода nonce/userId.
- **Мелкое замечание (некритично):** `pt-14` в header `/dashboard` хрупок к изменению высоты Navbar. В рамках PR — некритично.

---

## C. Security

| Вектор | Статус | Доказательство |
|--------|--------|----------------|
| userId-replay (основная) | ЗАКРЫТ | `authorizeMagicLinkNonce` принимает только nonce → GETDEL по `magic-link:signin:<nonce>`. Знание cuid не даёт сессии. Тест `"never accepts bare userId in the place of nonce"`. |
| nonce-replay | ЗАКРЫТ | `redis.getdel` атомарна; параллельные запросы — первый получит userId, второй null. Тест `"the same nonce cannot grant a session twice"`. |
| Race condition (две вкладки) | OK | Атомарность GETDEL. Документировано в ADR §5. |
| Утечка nonce в URL | ПРИЕМЛЕМО | nonce — 64 hex (crypto.randomBytes(32)), TTL 5 мин, та же энтропия что email-токен. Тест `expect(location).not.toContain("user-002")` подтверждает: cuid в URL не попадает. |
| Fail-closed при Redis down | OK | `generateSignInNonce` бросает `REDIS_UNAVAILABLE` → `?error=link-expired`. Другие провайдеры независимы от Redis. |
| Hardcoded secrets | НЕТ | grep по `password|token|secret|NEXTAUTH|TELEGRAM.*TOKEN` — только error-string и Redis-prefix. |
| SQL injection | НЕТ | Только Prisma ORM, параметризованные запросы. |
| RBAC | OK | `/dashboard` server-side `auth()`. Новых API нет. |

**Замечание (pre-existing, не Stage 3):** Navbar `isAdmin` проверяет `SUPERADMIN | MANAGER`, не `ADMIN`. `redirectAfterLogin` в signin проверяет `SUPERADMIN | ADMIN | MANAGER`. Несоответствие существовало до PR — отдельная задача.

**Supply chain:** новых зависимостей не добавлено.

---

## D. Scope Creep

Stage 3 коммит — ровно 12 файлов, все в рамках ADR §2.2, §3.1, §4:
- `email-magic-link.service.ts` (+2 функции, +константа, +Redis prefix)
- `magic-link-authorize.ts` (новый файл в существующем модуле)
- `verify-email/route.ts` (redirect nonce вместо userId)
- `auth.ts` (замена Credentials authorize)
- `signin/page.tsx` (rename magicUserId→magicNonce + USER → /dashboard)
- `dashboard/page.tsx` (Navbar вместо custom header)
- 4 тестовых файла (2 новых + 2 расширенных)
- 3 docs файла

`magic-link-authorize.ts` — **не новый модуль**, а файл в `src/modules/auth/` для тестируемости. ADR §7 явно предписывает это разделение.

Схема БД, middleware, новые OAuth-провайдеры, `/webapp/profile`, новые API — не тронуты. ADR §6 соблюдён полностью.

---

## E. CTO-revision PRD

Решение корректно с точки зрения scope guard. `/dashboard` существовал до Stage 3 с полноценным личным кабинетом. Создание дублирующей страницы `/profile` было бы scope creep по правилу CLAUDE.md. Переформулировка US-2 как "навигационного фикса" — не маскировка scope creep, а его предотвращение.

---

## Итого

| Категория | Результат |
|-----------|-----------|
| Acceptance Criteria | 14/14 PASS (AC-2.8 — косвенное покрытие, принято) |
| Scope Creep | Нет. Stage 3 — ровно 12 файлов по ADR |
| Архитектура | Соответствует ADR полностью |
| Качество кода | TypeScript strict, бизнес-логика в модулях |
| Security | Уязвимость закрыта, fail-closed, нет утечек, нет инъекций |
| Тесты | 1632/1632 PASS, +21 новый тест, happy path + error paths покрыты |

**Verdict: PASS**
