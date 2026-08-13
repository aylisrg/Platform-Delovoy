# Review: Ролевой ребилд Telegram Mini App «Деловой»

**RUN_ID:** `2026-08-13-miniapp-role-rebuild`
**Reviewer:** Code Reviewer (LLM-as-Judge)
**Диф:** `origin/main...HEAD`, 82 файла, +9810/-1105, 9 коммитов (`1174c90`…`f5897ce`)
**Тесты:** `npm test -- --run` → 226 файлов, **3378/3378 passed**, 31.2s. `tsc --noEmit` — чисто. `npm run lint` — 0 errors, 15 warnings (все в файлах вне дифа или уже существовавшие до PR — см. Качество кода).

## Вердикт: NEEDS_CHANGES

Ядро (US-1 auth/RBAC, US-5 Центр уведомлений, US-6 идемпотентность релизов на уровне модуля `notifications`) реализовано аккуратно и близко к тексту ADR, с сильным тестовым покрытием именно тех инвариантов, которые ADR требовал защитить (grandfather-правило, self-subscribed путь 2b, entity-scoped dedup с явными regression-тестами на `messenger.*`/`task.*`, понижение роли, strict-access). Найдены два MAJOR-дефекта — один в оркестрации `deploy.yml` (риск полного молчания о релизе именно в сценарии, который US-6 обязан закрывать), второй — пропуск rate limit на части путей нового эндпоинта Центра уведомлений. Оба конкретны, локализованы и исправимы без пересмотра архитектуры.

---

## Проверено

- PRD `docs/requirements/2026-08-13-miniapp-role-rebuild-prd.md` (7 US, 44 AC), ADR `docs/architecture/2026-08-13-miniapp-role-rebuild-adr.md` (14 разделов), context-log — построчно.
- `git diff origin/main...HEAD` по всем 82 файлам; `git log` — 9 коммитов, по одному на трек/группу задач.
- Track A целиком (`src/lib/webapp-auth.ts`, `src/lib/telegram-webapp.ts`, `src/app/api/webapp/auth/route.ts`, `src/app/api/webapp/link/confirm/route.ts`, `src/lib/webapp/{capabilities,navigation,validation,types}.ts`, `TelegramProvider.tsx`, `TabBar.tsx`) — построчно.
- Track C целиком (`catalog.ts`, `webapp-center.ts`, `subscribers.ts`, `notification-center/route.ts`, `notifications/page.tsx`, `service.ts` путь 2b) — построчно.
- Track D целиком (`release-notify.ts`, `dedup.ts`, `events.ts`, `admin/release-notify/route.ts`, `deploy.yml`, `bot/handlers/team-settings.ts`) — построчно, включая эмпирическую проверку поведения `bash -e` на `$(curl …)` (см. Проблема 1).
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
| AC-1.7 | PASS | `rateLimit(request, "public")` — первая строка `/api/webapp/auth` до любой криптографии. |
| AC-1.8 | PASS | `getWebAppJwtSecret()` бросает `WebAppAuthConfigError` при пустом/<16 символов секрете, роут → 503 `NOT_CONFIGURED`. Ленивая резолюция подтверждена тестом. |
| AC-1.9 | PASS | `timingSafeEqual` + regex-проверка формата хэша до `Buffer.from` в `telegram-webapp.ts:73-79`. |
| AC-5.1–5.4 | PASS | Каталог фильтруется по `sections`/`superadminAlways`; ADMIN и MANAGER с одинаковыми секциями дают идентичный результат (тест `capabilities.test.ts:83-93`). Категория `bookings` объединяет `gazebos`+`ps-park` — осознанное и задокументированное отступление от буквы AC-5.1 (уже согласовано в ADR §4). |
| AC-5.5 | PASS | `setEventPreference`/`upsertEventPreference` пишут немедленно; `notifyAdmin` путь 2b и `resolveReleaseAudience` читают предпочтения при каждой отправке, без кеша. |
| AC-5.6 | PASS | `ensureTelegramChannel` — create/verify/idempotent/no-reactivate, гонка параллельных открытий ловится через P2002. |
| AC-5.7 | PASS, двухслойно | CRITICAL-алерты физически не проходят через `dispatch()`; `notificationCenterUpdateSchema` — закрытый `z.enum(MANAGED_EVENT_TYPES)`. |
| AC-6.1 / AC-6.2 | PASS | `ReleaseAnnouncement.version` — PK, claim через `create`+P2002, атомарно решает и параллельные прогоны. |
| AC-6.3 | PASS на уровне `announceRelease`/`dispatch()` **и** проверенная логика reorder в `deploy.yml`, но см. **Проблема 1** — робастность самого шага CI подрывает гарантию в конкретном сценарии сбоя сети. |
| AC-6.4 | PASS | `setReleaseSubscription` — единственная точка записи (пишет и новую, и legacy-строку); `getTeamUser()` пускает всех `role !== USER`; тумблер в боте убран, легаси-callback ничего не пишет (regression-тест `team-settings.test.ts`). |
| AC-6.5 | PASS | Бэкфилл в SQL миграции, `ON CONFLICT DO NOTHING`, `mergedIntoUserId IS NULL` — соответствует и даже усиливает пример из ADR. |
| AC-6.6 | PASS на уровне `announceRelease` (fail-open на не-P2002 ошибку, тест есть) — но см. **Проблема 1**: гарантия «не молчим о релизе» на уровне пайплайна CI не полная. |
| AC-6.7 | PASS | `log.info`/`log.warn` с `source: "release-notify"` на каждый блок/fail-open. |
| US-2/US-3/US-4/US-7 | PASS (выборочная проверка) | `feed.ts` — санитизация `actions[].url` (только `https:`/относительные пути, `//`-protocol-relative отсекается), корректное схлопывание по `dedupKey`, `feedSeenAt`-watermark. Кафе — тонкие обёртки, DTO явно собран (без `user.email`/`user.name`/служебных полей), сервисы `cafe` не тронуты. Пеналти-диалог брони (AC-4.3) — свой UI поверх существующего `DELETE /api/webapp/bookings`, эндпоинт не менялся. Дизайн-токены/иконки — без `dangerouslySetInnerHTML`, эмодзи не смешаны с SVG. |

---

## Scope Check

- **Scope creep: нет.** Единственная затронутая директория под `src/modules/` — `src/modules/notifications/` (существующий модуль); `catalog.ts`/`webapp-center.ts`/`subscribers.ts`/`feed.ts` — файлы этого модуля, как и заявлено в задании ревью.
- `src/modules/cafe/{service,validation}.ts`, `src/modules/gazebos/*`, `src/modules/ps-park/*` — отсутствуют в дифе (проверено `git diff --stat`). Все новые кафе/брони-роуты — тонкие обёртки над существующими сервисами.
- Поверхности вне заявленных PRD (`notifications`, `src/app/webapp/`, `src/app/api/webapp/`, `bot/handlers/team-settings.ts`, `.github/workflows/deploy.yml`) — не обнаружены; `src/lib/webapp-auth.ts`, `src/lib/telegram-webapp.ts`, `src/lib/webapp/*`, `src/components/webapp/*` — обслуживающий код той же поверхности `webapp`, не отдельный модуль.
- Новых npm-зависимостей нет (`package.json`/`package-lock.json` — 0 строк в дифе).
- `CLAUDE.md` синхронизирован в том же PR (строка `notifications` дополнена Центром уведомлений и `system.release`).
- Лишних изменений/рефакторинга не по теме не найдено (diff в `gazebos`/`ps-park`/`BookingCard` и т.п. — только визуальный слой, без новых `fetch`/API-вызовов — проверено grep'ом по добавленным строкам).

---

## Качество кода

- TypeScript strict: OK. `tsc --noEmit` чисто; `any` в добавленных строках не найден (grep по `: any|<any>|as any` — 0 совпадений вне тестов).
- Zod-валидация: OK — все новые роуты валидируют вход (`initDataAuthSchema`, `feedQuerySchema`, `feedReadSchema`, `webappOrdersQuerySchema`, `notificationCenterUpdateSchema` с закрытым enum).
- API-формат: OK — везде `apiResponse`/`apiError`.
- `npm run lint`: 0 errors. 15 warnings — все либо в файлах вне дифа этого PR (`session-bill-modal.tsx`, `sidebar.tsx`, `vk-community-banner.tsx`, `ChatWindow.tsx`, `messenger/*`, `telephony/*`), либо предсуществующий unused-import в `src/modules/notifications/service.ts:9` (`getRecipientUserIds`) — эта строка идентична `origin/main`, PR её не добавлял (не regression, не блокирует).
- Тесты: PASS, 3378/3378, и по содержанию — не декоративные: `webapp-auth.test.ts` реально гоняет round-trip sign/verify и понижение роли через БД-мок, `dedup.test.ts` явно защищает `messenger.*`/`task.*` regression-тестами, `catalog.test.ts` держит инвариант «нет мёртвых тумблеров» и «CRITICAL не в каталоге».

---

## Безопасность

### Secrets leakage — OK
`grep -rE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` по добавленным строкам — только имена env-переменных, комментарии и тестовые фикстуры (`vi.stubEnv("NEXTAUTH_SECRET", "test-secret-with-enough-length")`). Fallback-секрет `"webapp-secret"` убран во всех трёх бывших копипастах, заменён на explicit throw. `.env*` не добавлен.

### RBAC — в основном OK, один пропуск (см. Проблема 2)
- `loadWebAppStaff` перепроверяет роль/секции из БД на каждый staff-запрос — не из токена. Понижение роли/merge аккаунта отражается немедленно (тест есть).
- `userId` везде берётся из проверенного токена (`user.id`/`guard.staff.id`), не из body/query.
- `MANAGER`/`ADMIN` дополнительно проверяются через `getUserAdminSections`/`resolveManagedCategories`, эквивалент `hasAdminSectionAccess`.
- Один пропуск — см. Проблема 2 ниже (rate limit, не сама авторизация: 401/403 отдаются корректно).

### Injection / XSS — OK
- Нет `$executeRawUnsafe`/raw SQL с пользовательским вводом (обе миграции — статичный SQL, без интерполяции пользовательских данных).
- Нет `dangerouslySetInnerHTML` во всём дифе (grep — 0 совпадений).
- `feed.ts::sanitizeActionUrl` — allowlist `https:`/относительные пути, явно режет `javascript:`, `tg:`, `data:`, `//host` (protocol-relative). Заголовок/текст ленты рендерятся как обычный JSX-текст (React-экранирование), не сырым HTML.

### Supply chain — OK
Новых зависимостей нет.

### Dangerous ops — OK
Обе миграции — только `ADD COLUMN`/`CREATE INDEX`/`CREATE TABLE`/`INSERT … ON CONFLICT DO NOTHING`. Ни одного `DROP`/`TRUNCATE`/`DELETE FROM`/`ALTER TYPE`/`SET NOT NULL`. Git-операции в дифе — не деструктивны.

---

## Что исправить (NEEDS_CHANGES)

### Проблема 1 (MAJOR) — `.github/workflows/deploy.yml`: реордер «Notify on success» ломает гарантию «не молчим о релизе» при сетевом сбое

Файл: `.github/workflows/deploy.yml`, шаг `Generate release notes & notify subscribers` (`id: release`, строки ~711-820) и шаг `Notify on success` (строки ~825-835, `if: success() && steps.release.outputs.notified != 'true'`).

`RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "${APP_URL}/api/admin/release-notify")` (строка ~807) не защищён от сбоя на уровне соединения (DNS, connection refused, timeout — `curl` без `--max-time` и без `|| …`). GitHub Actions выполняет `run:`-шаги как `bash --noprofile --norc -eo pipefail {0}` — при `-e` присваивание `VAR=$(failing_cmd)` аварийно завершает скрипт (эмпирически проверено в этой сессии: `x=$(curl -s --max-time 2 http://127.0.0.1:1/x); echo after` — строка `after` не печатается, скрипт падает с кодом 7).

Раньше (до этого PR) шаг «Notify on success» стоял **до** «Generate release notes…», поэтому «✅ Deploy OK» уходило независимо от исхода release-notify-шага. Теперь порядок намеренно (и правильно по замыслу ADR §6.5) обратный — но из-за этого, если curl к `${APP_URL}/api/admin/release-notify` упадёт на уровне соединения:
1. Шаг `release` падает **до** строки, которая пишет `notified=false` в `$GITHUB_OUTPUT`.
2. `success()` в шаге «Notify on success» становится `false` (упал предыдущий шаг) → групповое fallback-сообщение **тоже не отправляется**.
3. Job в целом помечается `failure` → срабатывает `Notify on failure` (`if: failure()`, строка 837) → владелец получает **«🚨 Deploy FAILED»**, хотя build/push/deploy/smoke-тесты реально прошли успешно.

Итог: ни персонального анонса, ни группового fallback — только ложная тревога о провале деплоя. Это прямо противоречит собственному тексту ADR §6.5 п.2 («группа получает подтверждение… **сеть/сервер не ответили** …») и PRD AC-6.6/риску №6 («молчание о реальном релизе хуже дубля», «требование протестировать на дружественном прогоне»). Дружественный прогон, описанный в ADR §11 Track D («при отключённом `RELEASE_NOTIFY_SECRET` приходит групповое Deploy OK»), эту ветку не покрывает — там curl вообще не вызывается (ранний `exit 0`).

**Исправление:** сделать вызов к `${APP_URL}/api/admin/release-notify` (и в идеале — Gemini-вызов) устойчивым к сбою соединения, чтобы скрипт всегда доходил до ветки `notified=false`, например:
```bash
RESPONSE=$(curl -s --max-time 15 -X POST \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  "${APP_URL}/api/admin/release-notify" || echo '{}')
```
(аналогично для `GEMINI_RESPONSE=$(curl … || echo '{}')`, если хочется закрыть тот же класс проблем и там).

### Проблема 2 (MAJOR) — `src/app/api/webapp/notification-center/route.ts`: rate limit не применяется к 401/403-ответам

Файл: `src/app/api/webapp/notification-center/route.ts`, `GET` (строки 44-51) и `PUT` (строки 68-75).

```ts
const guard = await requireStaff(request);
if (!guard.ok) return guard.response;       // ← ранний return для 401 И 403

const limited = await rateLimit(request, "authenticated", guard.staff.id);
if (limited) return limited;
```

`rateLimit()` вызывается только когда `requireStaff` вернул `ok: true`, то есть только для полноценного staff (`role !== USER`, не merged). Любой запрос с невалидным токеном (401) **или** с валидным токеном обычного `USER` (403 — «Раздел доступен только сотрудникам») **никогда не попадает под rate limit** — ни по IP, ни по пользователю. `USER` — дефолтная и самая массовая роль в приложении (получить валидный webapp-JWT с ролью `USER` может любой, кто открыл бота), поэтому это не узкий edge-case «мусорный токен», а реальный незащищённый путь: любой обычный гость может слать `GET`/`PUT /api/webapp/notification-center` неограниченно часто, и каждый запрос — минимум один поход в БД (`prisma.user.findUnique` внутри `loadWebAppStaff`).

Это расходится и с явным пунктом чеклиста ревью («rate limit на всех новых роутах»), и с таблицей ADR §12, где для этого эндпоинта заявлено «Rate limit: authenticated (240/мин на пользователя)» без оговорки про 401/403-пути, и с общим правилом CLAUDE.md «Rate limiting on all public endpoints» — здесь endpoint публично достижим любым аутентифицированным (пусть и не-staff) пользователем.

**Исправление:** выполнять `rateLimit` до/независимо от результата `requireStaff` — например, доставать `sub` через `verifyWebAppToken(request)` один раз в начале хендлера, рейт-лимитить по нему (или по IP через тир `"public"`, если токена нет вовсе), и только потом звать `loadWebAppStaff`/проверять роль. `GET`-хендлер уже вызывает `verifyWebAppToken` повторно чуть ниже (для `telegramId`) — оба вызова можно объединить в один при рефакторинге.

---

## Что хорошо

- `loadWebAppStaff`/`getWebAppCapabilities`/`resolveManagedCategories` последовательно проводят принцип «роль и права — всегда из БД для чувствительных операций», и это реально покрыто тестами на понижение роли, merge-аккаунт и strict-access наследование, а не просто продекларировано в комментариях.
- Путь 2b в `notifyAdmin` — образцовый пример аддитивного изменения: пути 1/3 буквально не тронуты (те же условия `explicitIds`/`channelDisabled`), новый код только добавляет, и это подтверждено regression-тестами именно на «поведение без явных подписок не меняется».
- `computeDedupKey` entity-scoped allowlist сопровождён явными regression-тестами с меткой `REGRESSION:` на `messenger.message.received` и `task.*` — ровно то, что просил ревью-чеклист, и по названию сразу понятно, что тест защищает от повторения прошлой ошибки.
- Миграция состояния «уведомления о релизах» сделана в SQL самой миграции (не в сидере/скрипте), с `ON CONFLICT DO NOTHING` и `mergedIntoUserId IS NULL` — детерминированно, идемпотентно, ревьюабельно за один проход.
- `sanitizeActionUrl` в `feed.ts` — по-настоящему defensive (allowlist, а не blocklist), с отдельной обработкой protocol-relative `//host`, которую легко забыть.
- `deploy.yml`-guard (`skip=true/false`) корректно fail-open на любом сбое `gh api` (`|| echo "0"`) и не блокирует `workflow_dispatch`/`workflow_run` — это отдельно проверено и работает верно; проблема найдена именно в другом шаге того же файла (см. Проблема 1).
