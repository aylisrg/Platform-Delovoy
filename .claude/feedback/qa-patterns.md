# QA Bug Patterns — Self-Improving Pipeline

> Этот файл автоматически обновляется после каждого QA-прогона.
> Developer agent читает его перед написанием кода, чтобы не повторять ошибки.
> Обновляется скриптом: `./scripts/collect-qa-feedback.sh`

---

## Частые ошибки

> Формат: `Паттерн → как избегать (источник)`. Пополняется QA-агентом вручную
> после каждого вердикта (см. `agents/qa.md`). При ≥ ~100 строк паттернов в
> файле — самые старые строки секции удаляются при добавлении новых.

### TypeScript / Качество кода
- Числовое поле для UI, посчитанное из внешних/производных данных (`penaltyAmount` и т.п.), рендерится без проверки → `NaN`/`Infinity` утекают в разметку как строка «NaN ₽» → перед рендером `Number.isFinite()`, иначе generic-лейбл, не сырое число (issue #543).
- Динамическая строка интерполируется в `new RegExp(\`...${str}...\`)` без экранирования → буквальные regex-метасимволы в `str` (особенно `.`) работают как wildcard, а не литерал → ложные совпадения на «похожем», но не идентичном тексте (`AC-1x1` матчится вместо только `AC-1.1`) → экранировать общим `escapeRegExp` (`str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`) перед интерполяцией; безопасно только если интерполируемое значение доказуемо не может содержать `.`/`*`/`+`/etc — не полагаться на это молча (issue #639).

### API / Валидация
- Мутирующий эндпоинт парсит тело вручную по отдельным полям вместо единой Zod-схемы на весь body → забытое поле проходит мимо валидации → всегда `schema.safeParse(rawBody)` целиком первым шагом, не point-валидация отдельных ключей (issue #432).
- Allow-лист публичных путей в `auth.config.ts` (`isPublicApiRoute`) матчит по префиксу модуля (`startsWith("/api/gazebos")`) → случайно открывает не только safe-каталожные GET, но и роуты с PII без авторизации и rate-limit → публичный список — точные пути/явные исключения, никогда префикс всего модуля (issue #438).
- Health-check/дашборд-роут считает soft-deletable модель через `prisma.<model>.count()` напрямую в обход сервисного слоя (где `deletedAt: null` уже стоит) → чинится реактивно по одной находке за раз, а не сразу для всех похожих мест (issues #489, #557, #620 — три раунда одного паттерна в разных модулях; QA #620 нашёл ещё живой непочиненный пример в `messenger/health.messageCount` и двух admin-дашбордах) → при фиксе одного такого роута грепом (`prisma\.<model>\.count`) проверить остальные `/api/*/health` и админ-дашборды на тот же прямой `.count()`/`.findMany()` без `deletedAt: null`, завести отдельный issue на каждый найденный, а не закрывать только заявленный (issue #620).
- Новое поле пишется только в JSON-«метадату» (`Booking.metadata.email` и т.п.), а не в канонической модели (`User.email`), но downstream-потребитель (например, `pay-online`) продолжает читать поле из канонической модели → значение из metadata туда никогда не доходит, хотя PRD обещал именно этот путь использования (чек/уведомление) → при добавлении нового «человеческого» поля в metadata грепом искать все места, читающие канонический аналог того же смысла (`User.email`/`User.phone`), и либо прокинуть фолбэк, либо явно завести follow-up issue, если фикс вне скоупа (issue #665).
- Новый debounced-по-вводу поисковый `GET`-роут (`.../search?q=`) под `requireAdminSection` не получает rate limit по дефолтной политике «Admin: no limit» из CLAUDE.md — но keystroke-эндпоинты в кодовой базе (`inventory/sku/search` с явным комментарием «fired on every debounced keystroke», `ps-park/sessions/[id]`) рейт-лимитятся вопреки этому дефолту → для любого debounced-по-вводу роута сразу добавлять `rateLimit(request, "authenticated", userId)`, не полагаться на «admin-роут» как автоматическое освобождение (issue #666).
- `POST`/`PATCH`-роут парсит `await request.json()` внутри общего `try {} catch {}`, не отдельно → битый JSON (`SyntaxError`) падает в тот же catch, что и непредвиденные ошибки сервиса, и отвечает `500 INTERNAL_ERROR` вместо `400`/`422 VALIDATION_ERROR`, которого требует security-чеклист `agents/qa.md` → системный паттерн почти во всех write-роутах (`gazebos`, `ps-park`, `rental/*`), не блокер конкретного PR, если роут воспроизводит уже существующий паттерн сиблинг-роута (например, `PATCH` того же модуля) — но для НОВОГО модуля/роута оборачивать `request.json()` в отдельный `try { } catch { return apiValidationError(...) }`, а не полагаться на внешний catch (issue #667).

### Тесты
- Новый тест на баг-фикс, ассертящий только форму вызова (`expect.objectContaining`), может пройти и без самого фикса при неверно настроенном моке → обязателен mutation-check: временно откатить фикс, убедиться что падают именно новые тесты и только они, вернуть фикс (issue #564 — откат 6 фиксов уронил ровно 6 тестов; issue #622 — ровно 5).
- Дедупликация по префиксу action-имени (`entries.some(e => e.action.startsWith("booking.create"))`) не матчит новые члены таксономии, добавленные позже с другим префиксом (`booking.admin_create` не начинается с `booking.create`) → ложноотрицательный пропуск проверки, тихо теряющийся при расширении семейства экшенов, зеркальный к #438 (там `startsWith` наоборот над-матчил) → при добавлении нового `action`-имени в существующее семейство явно проверять все `startsWith`/`includes`-условия дедупликации/классификации на предмет покрытия нового члена (issue #665).
- Дедуп/выбор «самой свежей записи», зависящий от `orderBy` в Prisma-запросе, тестируется с мокнутым `findMany` — если тест ассертит только `where`, а мок-данные подаются уже вручную отсортированными, смена реального `orderBy` (`desc`→`asc`) молча проходит тесты: мок не сортирует по переданному аргументу, порядок в тестовых данных решает всё → отдельно ассертить `orderBy` в `toHaveBeenCalledWith(expect.objectContaining({ orderBy: ... }))`, не полагаться на порядок мок-массива (issue #666).

### RBAC / Безопасность
- Route проверяет `hasRole(session.user, "MANAGER")`, но не вызывает `requireAdminSection(session, <module>)` → менеджер одного модуля мутирует/читает данные в чужом → сразу после role-check: `const denied = await requireAdminSection(session, "<slug>"); if (denied) return denied;` (issues #560, #561, #622 — 5 write-роутов в последнем).
- `prisma.<model>.findFirst/findUnique` по id в мутирующей сервис-функции ищет запись без `deletedAt: null` → можно менять/продлевать/отменять мягко удалённую запись → добавлять `deletedAt: null` в where везде, КРОМЕ функций, которым нужно видеть удалённые записи намеренно (soft/hard-delete сами) (issues #423, #489, #512, #557, #564 — 5+ повторов одного и того же пропуска).
- Пользовательский текст (комментарий, `problemNote` и т.п.) интерполируется в Telegram-сообщение с `parse_mode: "HTML"` без экранирования → HTML-инъекция в чужой чат → любое интерполируемое поле — через общий `escapeHtml` из `@/lib/telegram/escape.ts`, без исключений на «проверенный» источник (issues #471, #534).
- Код, дающий пользователю доступ к модулю/разделу (сидер, admin-эндпоинт назначения менеджера), создаёт `ModuleAssignment`, но забывает парный `AdminPermission` (или наоборот) → `hasModuleAccess`/`hasAdminSectionAccess` в `permissions.ts` проверяются независимо друг от друга — без обоих грантов либо UI сразу редиректит на `/admin/forbidden`, либо есть доступ к разделу UI без доступа к данным модуля → любой код, выдающий доступ пользователю, обязан создавать обе записи атомарно/в одной идемпотентной операции (issue #615).

### Scope Creep
- Заметил второй баг того же класса при фиксе первого (соседний файл/роут вне заявленного скоупа issue) → не чинить в этом же PR — заводить отдельную issue через `issue-queue.ts create --ready`, очередь доберётся сама (issues #625, #627, #628 — все найдены `code-reviewer` при ревью #564/#574).

---

## Статистика

| Дата | Отчёт | Кол-во багов | Категории |
|------|-------|-------------|-----------|
| 2026-04-12 | 2026-04-12-booking-engine-v2-phase-1a-qa-report.md | 13 | rbac, api, typescript, tests |
| 2026-04-12 | 2026-04-12-easter-eggs-memes-qa-report.md | 4 | rbac, api, typescript, tests |
| 2026-04-12 | 2026-04-12-inventory-product-management-qa-report.md | 24 | rbac, api, typescript, tests |
| 2026-04-25 | 2026-04-25-fix-login-public-profile-qa-report.md | 1 | rbac, api, typescript, tests, scope_creep |
| 2026-05-04 | 2026-05-04-ps-park-payment-required-on-complete-qa-report.md | 5 | rbac, api, typescript, tests, scope_creep |
| 2026-05-04 | 2026-05-04-clients-guest-cards-crud-qa-report.md | 1 | rbac, api, tests |
| 2026-05-04 | 2026-05-04-gazebos-payment-required-on-complete-qa-report.md | 1 | rbac, api, typescript, tests, scope_creep |
| 2026-08-10 | 2026-08-10-booking-relaunch-audit.md | 15 | rbac, api, typescript, tests, scope_creep |
| 2026-08-12 | 2026-08-12-issue-423-soft-delete-filter-qa-report.md | 2 | rbac, api, typescript, tests, scope_creep |
| 2026-08-12 | 2026-08-12-issue-432-patch-booking-zod-qa-report.md | 8 | rbac, api, tests, scope_creep |
| 2026-08-12 | 2026-08-12-issue-430-admin-booking-crm-attribution-qa-report.md | 7 | rbac, api, typescript, tests, scope_creep |
| 2026-08-12 | 2026-08-12-issue-425-booking-detail-card-errors-qa-report.md | 2 | rbac, api, tests, scope_creep |
| 2026-08-12 | 2026-08-12-issue-426-webapp-cancel-booking-core-qa-report.md | 4 | rbac, api, tests, scope_creep |
| 2026-08-12 | 2026-08-12-issue-427-bot-cancel-penalty-qa-report.md | 5 | rbac, api, typescript, tests, scope_creep |
| 2026-08-13 | 2026-08-13-issue-431-booking-history-pagination-qa-report.md | 6 | rbac, api, typescript, tests |
| 2026-08-13 | 2026-08-13-issue-478-noshow-checkin-conflict-qa-report.md | 7 | rbac, api, tests, scope_creep |
| 2026-08-13 | 2026-08-13-issue-433-reschedule-calendar-notify-qa-report.md | 7 | rbac, api, typescript, tests, scope_creep |
| 2026-08-13 | 2026-08-13-issue-434-module-settings-dead-config-qa-report.md | 5 | rbac, api, typescript, tests, scope_creep |
| 2026-08-13 | 2026-08-13-issue-435-subscription-refund-on-cancel-qa-report.md | 1 | rbac, api, typescript, tests, scope_creep |
| 2026-08-13 | 2026-08-13-miniapp-role-rebuild-qa-report.md | 10 | rbac, api, typescript, tests, scope_creep |
| unknown | 436-qa-report.md | 1 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-527-anon-booking-pii-access-qa-report.md | 2 | rbac, api, typescript, tests, scope_creep |
| 2026-08-13 | 2026-08-13-issue-438-booking-history-search-qa-report.md | 11 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-438-booking-history-search-reverify-qa-report.md | 7 | rbac, api, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-439-reschedule-date-resource-qa-report.md | 1 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-480-release-notes-sha-race-qa-report.md | 8 | rbac, api, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-471-escapehtml-consolidate-qa-report.md | 9 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-502-webapp-penalty-confirmation-qa-report.md | 6 | rbac, api, typescript, tests |
| 2026-08-14 | 2026-08-14-issue-534-bot-escapehtml-qa-report.md | 1 | rbac, api, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-464-npm-ci-qa-report.md | 1 | rbac, api, tests |
| unknown | issue-489-qa-report.md | 5 | rbac, api, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-560-booking-get-rbac-qa-report.md | 5 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-509-booking-userid-filter-qa-report.md | 2 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-525-deploy-guard-dedup-qa-report.md | 7 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-570-blocking-smoke-tests-qa-report.md | 15 | rbac, api, tests |
| 2026-08-14 | 2026-08-14-issue-572-playwright-e2e-qa-report.md | 14 | rbac, api, tests |
| 2026-08-14 | 2026-08-14-issue-573-queue-watchdog-qa-report.md | 2 | rbac, api, typescript, tests, scope_creep |
| unknown | issue-576-qa-report.md | 19 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-576-onrequesterror-tracking-reverify-qa-report.md | 10 | rbac, api, tests |
| 2026-08-14 | 2026-08-14-issue-543-penalty-nan-infinity-qa-report.md | 2 | rbac, api, tests |
| unknown | issue-536-qa-report.md | 2 | rbac, api, tests |
| 2026-08-15 | 2026-08-15-issue-578-error-budget-watch-qa-report.md | 3 | rbac, api, typescript, tests, scope_creep |
| 2026-08-15 | 2026-08-15-issue-578-error-budget-watch-reverify-qa-report.md | 2 | rbac, api, typescript, tests |
| 2026-04-12 | 2026-04-12-ps-park-inventory-booking-qa-report.md | 15 | rbac, api, typescript, tests |
| 2026-04-12 | 2026-04-12-ps-park-ux-redesign-qa-report.md | 3 | rbac, api, typescript, tests |
| 2026-04-12 | 2026-04-12-telephony-novofon-integration-qa-report.md | 3 | rbac, api, typescript, tests, scope_creep |
| 2026-04-14 | 2026-04-14-admin-bbq-playpark-management-qa-report.md | 0 | rbac, api, typescript, tests, scope_creep |
| 2026-04-14 | 2026-04-14-release-prep-mobile-perf-qa-report.md | 11 | rbac, api, typescript, tests, scope_creep |
| 2026-04-15 | 2026-04-15-admin-analytics-dashboard-qa-report.md | 11 | rbac, api, typescript, tests, scope_creep |
| 2026-04-15 | 2026-04-15-micro-fixes-batch-qa-report.md | 10 | rbac, api, typescript, tests, scope_creep |
| 2026-04-16 | 2026-04-16-auth-ux-profile-contacts-qa-report.md | 8 | rbac, api, typescript, tests, scope_creep |
| 2026-04-16 | 2026-04-16-mobile-admin-redesign-qa-report.md | 3 | rbac, api, typescript, tests, scope_creep |
| 2026-04-17 | 2026-04-17-checkout-discount-system-qa-report.md | 20 | rbac, api, typescript, tests, scope_creep |
| 2026-04-21 | 2026-04-21-rental-email-notifications-qa-report.md | 10 | rbac, api, typescript, tests, scope_creep |
| 2026-04-21 | 2026-04-21-staging-and-backups-qa-report.md | 8 | rbac, api, typescript, tests, scope_creep |
| 2026-04-25 | 2026-04-25-feedback-office-linkage-qa-report.md | 0 | rbac, api, typescript, tests, scope_creep |
| 2026-04-27 | 2026-04-27-ps-park-session-shift-fix-qa-report.md | 0 | rbac, api, typescript, tests, scope_creep |
| 2026-05-04 | 2026-05-04-cafe-order-booking-link-qa-report.md | 0 | rbac, api, typescript, tests, scope_creep |
| 2026-05-04 | 2026-05-04-ps-park-expired-session-red-card-qa-report.md | 0 | rbac, api, typescript, tests, scope_creep |
| 2026-05-10 | 2026-05-10-cron-overdue-reminders-qa-report.md | 0 | rbac, api, typescript, tests, scope_creep |
| 2026-05-10 | 2026-05-10-web-push-api-routes-qa-report.md | 12 | rbac, api, typescript, tests, scope_creep |
| 2026-05-10 | 2026-05-10-web-push-channel-skeleton-qa-report.md | 7 | rbac, api, typescript, tests, scope_creep |
| 2026-05-10 | 2026-05-10-web-push-pwa-ui-qa-report.md | 5 | rbac, api, typescript, tests, scope_creep |
| 2026-08-13 | 2026-08-13-issue-437-admin-booking-telegram-notify-qa-report.md | 0 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-440-noshow-threshold-config-qa-report.md | 0 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-479-scheduled-tasks-lock-gitignore-qa-report.md | 0 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-495-local-fonts-qa-report.md | 0 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-571-critical-alerting-qa-report.md | 0 | rbac, api, typescript, tests, scope_creep |
| 2026-08-15 | 2026-08-15-issue-540-filter-test-feedback-qa-report.md | 17 | rbac, api, typescript, tests |
| 2026-08-15 | 2026-08-15-issue-548-btree-gist-exclusion-qa-report.md | 4 | rbac, api, typescript, tests, scope_creep |
| 2026-08-14 | 2026-08-14-issue-567-ps-park-min-booking-hours-admin-qa-report.md | 10 | rbac, api, typescript, tests |
| 2026-08-15 | 2026-08-15-issue-549-ps-park-booking-history-review-qa-report.md | 1 | rbac, api, typescript, tests, scope_creep |
| 2026-08-15 | 2026-08-15-issue-550-route-tests-booking-subscriptions-qa-report.md | 2 | rbac, api, typescript, tests, scope_creep |
| unknown | issue-557-qa-report.md | 9 | rbac, api, tests, scope_creep |
| 2026-08-15 | 2026-08-15-issue-561-ps-park-bill-module-scope-qa-report.md | 1 | rbac, api, typescript, tests |
| unknown | issue-622-qa-report.md | 8 | rbac, api, typescript, tests |
| unknown | issue-574-qa-report.md | 2 | rbac, api, typescript, tests |
| unknown | 591-admin-rbac-bypass-qa-report.md | 8 | rbac, api, tests |
| unknown | issue-579-qa-report.md | 5 | rbac, api, typescript, tests, scope_creep |
| unknown | issue-575-qa-report.md | 8 | rbac, api, typescript, tests, scope_creep |
| unknown | issue-585-qa-report.md | 18 | rbac, api, tests, scope_creep |
| unknown | issue-614-qa-report.md | 9 | rbac, api, typescript, tests, scope_creep |
| 2026-08-15 | 2026-08-15-issue-577-nginx-perf-telemetry-qa-report.md | 5 | rbac, api, tests |
| unknown | issue-615-qa-report.md | 6 | rbac, api, typescript, tests |
| unknown | 580-gate-verdict-markers-qa-report.md | 2 | rbac, api, tests |
| unknown | issue-616-qa-report.md | 10 | rbac, api, typescript, tests |
| 2026-08-16 | 2026-08-16-issue-564-ps-park-deletedat-followup-qa-report.md | 1 | rbac, typescript, tests |
| unknown | 582-pipeline-metrics-qa-report.md | 7 | rbac, api, tests |
| unknown | 581-event-source-registry-qa-report.md | 2 | rbac, api, typescript, tests, scope_creep |
| unknown | issue-617-qa-report.md | 9 | rbac, api, tests |
| unknown | issue-620-qa-report.md | 17 | rbac, api, typescript, tests, scope_creep |
| unknown | issue-628-qa-report.md | 2 | rbac, api, tests, scope_creep |
| unknown | issue-647-qa-report.md | 2 | rbac, api, typescript, tests, scope_creep |
| unknown | issue-639-qa-report.md | 17 | rbac, api, typescript, tests, scope_creep |
| unknown | issue-650-qa-report.md | 16 | rbac, api, typescript, tests, scope_creep |
| unknown | issue-665-qa-report.md | 8 | rbac, api, typescript, tests, scope_creep |
| unknown | issue-666-qa-report.md | 20 | rbac, api, typescript, tests |
| unknown | issue-667-qa-report.md | 2 | rbac, api, typescript, tests, scope_creep |
| unknown | issue-625-qa-report.md | 17 | rbac, api, typescript, tests, scope_creep |
