# Review: Ролевой ребилд Telegram Mini App «Деловой»

**RUN_ID:** `2026-08-13-miniapp-role-rebuild`
**Reviewer:** Code Reviewer (LLM-as-Judge)
**Диф:** `origin/main...HEAD`, финальный коммит `19d0a27`, merge-base с `origin/main` — `555347c` (не сдвигался между проверками).
**Тесты:** `npm test -- --run` → 226 файлов, **3382/3382 passed**, 32.0s (было 3378 — +4 теста в фиксе). `tsc --noEmit` — чисто. `npm run lint` — 0 errors, 15 warnings (все вне дифа этого PR или предсуществующие — см. «Качество кода»).

## Вердикт: PASS

Оба MAJOR из первичного ревью исправлены в коммите `19d0a27` и независимо перепроверены (не со слов разработчика — чтением итогового кода, эмпирической проверкой поведения shell-скрипта и повторным прогоном полного тестового набора). Ядро (US-1 auth/RBAC, US-5 Центр уведомлений, US-6 идемпотентность релизов) реализовано точно по ADR, с тестами на все заявленные инварианты. Scope creep нет, миграции только аддитивные, секретов/утечек/injection не найдено.

---

## Повторная проверка (после коммита `19d0a27`)

Проверялись **только** два MAJOR из первичного ревью — по прямому указанию координатора; три минорных QA-фикса (bookings 401-UX, русская строка в диалоге отмены, 429-тест для `cafe/orders`) не перепроверялись построчно, но не роняют тесты/типы при полном прогоне и не задевают ничего из уже проверенного ядра.

### MAJOR-1 — deploy.yml: устранено

Файл: `.github/workflows/deploy.yml:806-813`.

```bash
RESPONSE=$(curl -s --max-time 15 -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "${APP_URL}/api/admin/release-notify" || echo '{}')
```

Проверено:
- Чтением диффа коммита `19d0a27` — `|| echo '{}'` добавлен именно на ту команду, что была указана в проблеме, плюс `--max-time 15` (раньше таймаута не было вовсе — возможность зависнуть тоже закрыта). Аналогичный `|| echo ''` добавлен и на Gemini-curl (строка 764) тем же классом дефекта, хотя это не входило в исходную проблему.
- **Эмпирически, в этой сессии**, тем же способом, что и в первичном ревью: `bash --noprofile --norc -eo pipefail -c 'RESPONSE=$(curl -s --max-time 2 "http://127.0.0.1:1/x" || echo "{}"); echo "after: $RESPONSE"; ...'` — теперь скрипт **доходит до конца** (`after: {}`, `notified=false`, `exit 0`), тогда как до фикса он падал на строке присваивания. Это напрямую снимает сценарий «шаг падает раньше записи `notified=false` → `success()` в `Notify on success` тоже false → ни анонса, ни fallback, только ложный `Deploy FAILED`».
- Порядок шагов (`release` перед `Notify on success`, условие `if: success() && steps.release.outputs.notified != 'true'`) не менялся и остаётся корректным — сама эта логика вопросов не вызывала, проблема была только в устойчивости шага к сетевому сбою.

### MAJOR-2 — notification-center: устранено

Файл: `src/app/api/webapp/notification-center/route.ts:36-64` (`requireStaff`).

Новый порядок: `verifyWebAppToken` (чистая проверка подписи, без БД) → нет токена: `rateLimit(request, "public")` по IP → 401 → есть токен: `rateLimit(request, "authenticated", tokenUser.id)` по `userId` → и только потом `loadWebAppStaff` (ре-чек роли из БД). И `GET`, и `PUT` используют этот единый `requireStaff`.

Проверено:
- Чтением кода — rate limit теперь применяется **до** похода в БД за ролью в обеих ветках (нет токена / токен есть, но роль `USER`), что и требовалось: раньше 401/403-пути обходили лимит целиком.
- Побочный плюс: `GET`-хендлер больше не вызывает `verifyWebAppToken` дважды — `requireStaff` сразу возвращает `telegramId` вместе со `staff`.
- Новые тесты в `src/app/api/webapp/notification-center/__tests__/route.test.ts`, блок `describe("порядок rate limit (review MAJOR-2)")` — прочитаны построчно, соответствуют ровно заявленным трём сценариям и реально проверяют то, что заявлено, а не декоративны:
  - `429 для валидного токена срабатывает до ре-чека роли из БД` — assert на `rateLimit` вызван с `("authenticated","u1")` **и** `loadWebAppStaff`/`mockGetCenter` НЕ вызваны (БД не тронута при лимите).
  - `USER-роль (403-путь) тратит свой rate-limit-бюджет` — assert, что `rateLimit(..., "authenticated", "u1")` вызывается даже когда `loadWebAppStaff` вернул 403 — это прямое доказательство исправления исходной уязвимости (раньше этот вызов не происходил вовсе).
  - `без валидного токена лимитируется публичным тиром по IP` — assert на `rateLimit(..., "public")` и что `loadWebAppStaff` не вызывается.
- `npm test -- --run` в этой сессии (после фикса) — **3382/3382 passed** (было 3378 до фикса, +4 новых теста: 3 из блока выше + 1 429-тест для `cafe/orders`). `tsc --noEmit` — чисто.

### Итог по MAJOR

Оба дефекта закрыты по существу, не косметически: первый — эмпирически подтверждённым изменением поведения shell-скрипта под `set -e`, второй — изменением порядка вызовов с новыми тестами, которые различают ровно тот сценарий (USER-роль тратит бюджет), который раньше был дырой. Blocker/Major не осталось.

---

## Проверено (первичное ревью)

- PRD `docs/requirements/2026-08-13-miniapp-role-rebuild-prd.md` (7 US, 44 AC), ADR `docs/architecture/2026-08-13-miniapp-role-rebuild-adr.md` (14 разделов), context-log — построчно.
- `git diff origin/main...HEAD` по всем файлам; `git log` — по коммиту на трек/группу задач.
- Track A целиком (`src/lib/webapp-auth.ts`, `src/lib/telegram-webapp.ts`, `src/app/api/webapp/auth/route.ts`, `src/app/api/webapp/link/confirm/route.ts`, `src/lib/webapp/{capabilities,navigation,validation,types}.ts`, `TelegramProvider.tsx`, `TabBar.tsx`) — построчно.
- Track C целиком (`catalog.ts`, `webapp-center.ts`, `subscribers.ts`, `notification-center/route.ts`, `notifications/page.tsx`, `service.ts` путь 2b) — построчно.
- Track D целиком (`release-notify.ts`, `dedup.ts`, `events.ts`, `admin/release-notify/route.ts`, `deploy.yml`, `bot/handlers/team-settings.ts`) — построчно, включая эмпирическую проверку поведения `bash -e` на `$(curl …)`.
- Track B выборочно: `feed.ts` (полностью, включая санитизацию URL), `cafe/checkout`+`cafe/orders` роуты (полностью), `bookings/page.tsx` (диалог штрафа AC-4.3, полностью), `cafe/page.tsx`/`webapp/page.tsx` (рендер user-контента, навигация ссылок — выборочно), `gazebos`/`ps-park`/`BookingCard`/`BookingConfirm`/`ResourceCard`/`SlotPicker`/`SuccessScreen` — diff проверен на отсутствие новых `fetch`/`await`/`/api/` вызовов (только визуальный рефактор, бизнес-логика не тронута).
- Обе миграции (`20260813120000_webapp_feed_read_state`, `20260813130000_release_announcement`) и `prisma/schema.prisma`.
- `CLAUDE.md` синк, `package.json`/`package-lock.json` (без изменений — новых зависимостей нет).
- Секреты: `grep` по добавленным строкам на `password|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[-_]key` — только имена env-переменных и тестовые фикстуры (`vi.stubEnv`), утечек нет.
- Scope: список изменённых директорий под `src/modules/` — только `src/modules/notifications/*` (существующий модуль); `cafe`/`gazebos`/`ps-park` `service.ts`/`validation.ts` не в дифе.

---

## Acceptance Criteria (выборочно US-1/US-5/US-6, построчно; остальные — по факту чтения кода)

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1.1–1.3 | PASS | `buildNavigation(caps)` — единственный источник состава; `profileEntries` шире для staff. Табы одинаковы для всех ролей осознанно (ADR §1, AC-1.3) — не баг. |
| AC-1.4 | PASS | Таб «Чаты» убран из `BASE_TABS`; `/webapp/messenger/**` в коде остался нетронутым. |
| AC-1.5 / AC-5.8 | PASS | `loadWebAppStaff` перечитывает `role`/`mergedIntoUserId` из БД на каждый запрос, токен участвует только `sub`-ом. Тест на понижение роли (`webapp-auth.test.ts:97-112`) — токен врёт `SUPERADMIN`, БД говорит `USER` → 403. |
| AC-1.6 | PASS | `TabBar`/`Profile` рендерят скелет до `ready`; `capabilities` приходят тем же ответом, что и токен. |
| AC-1.7 | PASS | `rateLimit(request, "public")` — первая строка `/api/webapp/auth` до любой криптографии; в `notification-center` после фикса — тоже до похода в БД (см. «Повторная проверка»). |
| AC-1.8 | PASS | `getWebAppJwtSecret()` бросает `WebAppAuthConfigError` при пустом/<16 символов секрете, роут → 503 `NOT_CONFIGURED`. Ленивая резолюция подтверждена тестом. |
| AC-1.9 | PASS | `timingSafeEqual` + regex-проверка формата хэша до `Buffer.from` в `telegram-webapp.ts:73-79`. |
| AC-5.1–5.4 | PASS | Каталог фильтруется по `sections`/`superadminAlways`; ADMIN и MANAGER с одинаковыми секциями дают идентичный результат (тест `capabilities.test.ts:83-93`). Категория `bookings` объединяет `gazebos`+`ps-park` — осознанное и задокументированное отступление от буквы AC-5.1 (уже согласовано в ADR §4). |
| AC-5.5 | PASS | `setEventPreference`/`upsertEventPreference` пишут немедленно; `notifyAdmin` путь 2b и `resolveReleaseAudience` читают предпочтения при каждой отправке, без кеша. |
| AC-5.6 | PASS | `ensureTelegramChannel` — create/verify/idempotent/no-reactivate, гонка параллельных открытий ловится через P2002. |
| AC-5.7 | PASS, двухслойно | CRITICAL-алерты физически не проходят через `dispatch()`; `notificationCenterUpdateSchema` — закрытый `z.enum(MANAGED_EVENT_TYPES)`. |
| AC-6.1 / AC-6.2 | PASS | `ReleaseAnnouncement.version` — PK, claim через `create`+P2002, атомарно решает и параллельные прогоны. |
| AC-6.3 | PASS | `announceRelease`/`dispatch()` + корректный reorder в `deploy.yml`; шаг `release` теперь устойчив к сетевому сбою (см. MAJOR-1) — гарантия «ровно одно сообщение / не ноль» держится и в failure-сценарии. |
| AC-6.4 | PASS | `setReleaseSubscription` — единственная точка записи (пишет и новую, и legacy-строку); `getTeamUser()` пускает всех `role !== USER`; тумблер в боте убран, легаси-callback ничего не пишет (regression-тест `team-settings.test.ts`). |
| AC-6.5 | PASS | Бэкфилл в SQL миграции, `ON CONFLICT DO NOTHING`, `mergedIntoUserId IS NULL` — соответствует и даже усиливает пример из ADR. |
| AC-6.6 | PASS | Fail-open на не-P2002 ошибку в `announceRelease` (тест есть) **плюс** устойчивость самого CI-шага к сетевому сбою (см. MAJOR-1) — «не молчим о релизе» теперь закрыто и на уровне модуля, и на уровне пайплайна. |
| AC-6.7 | PASS | `log.info`/`log.warn` с `source: "release-notify"` на каждый блок/fail-open. |
| US-2/US-3/US-4/US-7 | PASS (выборочная проверка) | `feed.ts` — санитизация `actions[].url` (только `https:`/относительные пути, `//`-protocol-relative отсекается), корректное схлопывание по `dedupKey`, `feedSeenAt`-watermark. Кафе — тонкие обёртки, DTO явно собран (без `user.email`/`user.name`/служебных полей), сервисы `cafe` не тронуты. Пеналти-диалог брони (AC-4.3) — свой UI поверх существующего `DELETE /api/webapp/bookings`, эндпоинт не менялся; после фикса дополнительно различает 401 («Сессия истекла») от прочих ошибок. Дизайн-токены/иконки — без `dangerouslySetInnerHTML`, эмодзи не смешаны с SVG. |

---

## Scope Check

- **Scope creep: нет.** Единственная затронутая директория под `src/modules/` — `src/modules/notifications/` (существующий модуль); `catalog.ts`/`webapp-center.ts`/`subscribers.ts`/`feed.ts` — файлы этого модуля.
- `src/modules/cafe/{service,validation}.ts`, `src/modules/gazebos/*`, `src/modules/ps-park/*` — отсутствуют в дифе. Все новые кафе/брони-роуты — тонкие обёртки над существующими сервисами.
- Поверхности вне заявленных PRD — не обнаружены; `src/lib/webapp-auth.ts`, `src/lib/telegram-webapp.ts`, `src/lib/webapp/*`, `src/components/webapp/*` — обслуживающий код той же поверхности `webapp`, не отдельный модуль.
- Новых npm-зависимостей нет.
- `CLAUDE.md` синхронизирован в том же PR.
- Фикс `19d0a27` — точечный (deploy.yml guard, порядок rate limit, 3 минорных UX-правки), новых поверхностей/файлов вне уже согласованного скоупа не добавляет.

---

## Качество кода

- TypeScript strict: OK. `tsc --noEmit` чисто и после фикса.
- Zod-валидация: OK — все новые роуты валидируют вход.
- API-формат: OK — везде `apiResponse`/`apiError`.
- `npm run lint`: 0 errors и после фикса.
- Тесты: PASS, **3382/3382** (было 3378 — +4 новых, все содержательные, см. «Повторная проверка»).

---

## Безопасность

### Secrets leakage — OK
Утечек не найдено (см. первичное ревью, повторно не менялось).

### RBAC — OK
- `loadWebAppStaff` перепроверяет роль/секции из БД на каждый staff-запрос. Понижение роли/merge аккаунта отражается немедленно.
- `userId` везде берётся из проверенного токена, не из body/query.
- Rate limit после фикса применяется на всех путях `notification-center`, включая 401/403 — см. MAJOR-2 выше. Пропуска не осталось.

### Injection / XSS — OK
Без изменений с первичного ревью: нет raw SQL с пользовательским вводом, нет `dangerouslySetInnerHTML`, `sanitizeActionUrl` — allowlist-подход.

### Supply chain — OK
Новых зависимостей нет (в т.ч. в фиксе `19d0a27`).

### Dangerous ops — OK
Обе миграции — только аддитивные операции. Фикс `19d0a27` миграций не касается.

**Security-инцидентов не найдено. Оба найденных ранее MAJOR (один из которых — по существу security/reliability-дефект: незащищённый rate limit) устранены и перепроверены independently.**

---

## Что хорошо

- `loadWebAppStaff`/`getWebAppCapabilities`/`resolveManagedCategories` последовательно проводят принцип «роль и права — всегда из БД для чувствительных операций», подтверждено тестами на понижение роли, merge-аккаунт и strict-access наследование.
- Путь 2b в `notifyAdmin` — образцовый пример аддитивного изменения: пути 1/3 не тронуты, подтверждено regression-тестами.
- `computeDedupKey` entity-scoped allowlist — явные `REGRESSION:`-тесты на `messenger.message.received` и `task.*`.
- Миграция состояния «уведомления о релизах» — в SQL самой миграции, идемпотентно, `ON CONFLICT DO NOTHING` + `mergedIntoUserId IS NULL`.
- `sanitizeActionUrl` в `feed.ts` — defensive allowlist с обработкой protocol-relative `//host`.
- Реакция на ревью в `19d0a27` — не косметическая: оба MAJOR закрыты по существу (устойчивость shell-скрипта к сбою, а не просто «добавили try/catch»; порядок вызовов rate limit/DB, а не просто «добавили ещё один rateLimit куда попало»), с точечными regression-тестами именно на ранее дырявый сценарий (`USER-роль тратит бюджет до похода в БД`).
