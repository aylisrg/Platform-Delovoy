# ADR: Команда, доступы и уведомления сотрудников

**Статус:** Принято (Architect, 2026-10-25) → Реализовано в PR #1155 (фазы 1–9, §11). Реализация — **один PR**, внутри него фазы-коммиты (§11).
**RUN_ID:** `2026-10-25-team-access-notifications`
**Основание:** PRD `docs/requirements/2026-10-25-team-access-notifications-prd.md`, контекст-лог `docs/context/2026-10-25-team-access-notifications-context.md`.
**Затронутые модули:** `users`, `notifications`, `telegram-link`, `clients` (+ `src/lib/auth*`, `src/lib/permissions.ts`, `src/lib/webapp-auth.ts`, бот, админ-UI, Mini App). **Новых модулей нет.** Новых npm-пакетов нет.

---

## 0. Контекст

Владелец не может исключить сотрудника (жёсткий `DELETE` упирается в RESTRICT-FK), смена роли оставляет права/подписки/сессию, нет карточки сотрудника, экран уведомлений врёт (список получателей раздела = «выкл», Авито мимо тумблера, «суперадмины получают всегда»), нет статистики доставки и реакций, у одного человека два аккаунта (email + бот), самопривязка по OTP никогда не работала.

Факты кода, на которых построены решения (проверено 2026-10-25):

| Факт | Где | Следствие для дизайна |
|---|---|---|
| JWT-сессии; `role`/`adminSections` пишутся в токен только при входе / `trigger==="update"` | `src/lib/auth.ts:79-115`, `auth.config.ts:92-108` | нужен механизм версии сессии (Q1) |
| `src/proxy.ts` использует edge-совместимый `authConfig` без БД; полный `jwt`-callback (`auth.ts`) выполняется при каждом `auth()` в route handlers / server components и в `/api/auth/session` | `src/proxy.ts`, `auth.ts` | проверку отзыва ставим в полный callback + клиентский watcher, прокси не трогаем |
| Mini App: staff-роуты уже перечитывают роль из БД (`loadWebAppStaff`), но обычные роуты доверяют токену 24 ч | `src/lib/webapp-auth.ts` | `sv` в токен Mini App |
| Списки получателей — JSON `Module.config.notificationRecipients`; `Module.config` читают/пишут RMW-ом ещё 6 мест (`gazebos/ps-park settings`, `routing`, `channel-test`, `telegram`, `architect-service`) | `recipients.ts`, `webapp-center.ts` | выносим в таблицу (Q2) |
| `dispatch()` уже читает `NotificationEventPreference` с дефолтом `enabled=true`: явное `false` фактически блокирует и список, и Авито; Центр показывает «выкл», когда строки нет | `dispatch/dispatcher.ts:26`, `webapp-center.ts:219` | «выкл побеждает» уже почти правда — чиним расчёт и экран единым резолвером (Q7) |
| Клиентские уведомления (`notifyClient`) идут через легаси `NotificationPreference.enableBooking/enableOrder/enableReminder` и `channels/*`, **не** через `NotificationEventPreference`/`dispatch()` | `notifications/service.ts:51-188` | ключи подписок сотрудника и клиента фактически не пересекаются (Q8) |
| Лента Mini App показывает **все** `OutgoingNotification` пользователя (любой канал) + `InAppNotification` | `feed.ts:405-438` | прочтение в ленте — реакция для любого канала; «канал Лента» = `InAppNotification` (Q3) |
| `attemptFallback` создаёт вторую строку с тем же `dedupKey` и `fallbackOfId` | `dispatcher.ts:263-278` | логическое уведомление = цепочка `coalesce(fallbackOfId, id)` |
| `externalId` от канала выбрасывается; пропуски `dispatch()` строк не оставляют | `dispatcher.ts:196-200`, `:22-39` | новые поля и таблица пропусков (Q3) |
| `WebPushChannel` шлёт `{title, body, actions}`, а `public/sw.js` открывает `data.url` → клик по push всегда ведёт на `/admin/dashboard` | `web-push/index.ts:86`, `sw.js:146,172` | чиним попутно (нужно для трекинга) |
| Mini App `/api/webapp/auth` **создаёт** USER-аккаунт по `telegramId` при первом открытии, а `requestLink` отвечает 409, если `telegramId` уже занят → OTP-привязка недостижима в принципе; код только `console.log` | `webapp/auth/route.ts:51-61`, `telegram-link/service.ts:69-75,129` | OTP = подтверждение email + слияние «пустого» TG-аккаунта (Q9) |
| `mergeClients` сначала пишет в primary `email/phone/telegramId` вторичного, потом обнуляет их у вторичного → `P2002` на `@unique` при заполнении пустого поля primary; переносит права вторичного; удаляет `OutgoingNotification` дублирующих каналов; не трогает `Subscription`, чаты, `InAppNotification`, списки получателей | `clients/service.ts:1112-1493` | новый движок слияния (Q6) |
| Сидер `core.ts` делает `upsert` SUPERADMIN по `SUPERADMIN_TELEGRAM_ID` (с fallback-значением в коде); `nedelovoy-grants.ts` выдаёт грант всем `role=SUPERADMIN` без фильтра `mergedIntoUserId` | `scripts/seeds/*` | предупреждение + запрет вливать сидированного (Q6) |
| `getUserAdminSections(ADMIN)` = только явные гранты; `ADMIN_EDITABLE_MODULES` (gazebos, ps-park, inventory) дают ADMIN права по роли только на уровне API; PUT прав отклоняет нестрогие разделы для ADMIN/SUPERADMIN | `permissions.ts:190-216`, `admin/permissions/[userId]/route.ts:100-106` | единый источник разделов (Q10) |
| `lastSeenAt` обновляет только бот; `AuditLog auth.signin.success` пишется на каждый вход (NextAuth `events.signIn`, бот) | `auth.ts:117-134` | новая колонка `lastLoginAt` с бэкфиллом из журнала (Q11) |

---

## 1. Сводка решений (ответы на 12 вопросов PO)

### Q1. Отзыв сессий (≤ 60 с; цель — следующий запрос)

**Решение: версия сессии на пользователе + проверка в полном `jwt`-callback с Redis-кэшем (TTL 60 с) + клиентский `SessionWatcher` в админке + `sv` в токене Mini App.**

1. `User.sessionVersion Int @default(0)`. Инкремент («bump») — в той же транзакции, что и: исключение из команды, **любое понижение роли**, снятие хотя бы одного раздела в «Правах», вливание аккаунта вторичным при слиянии.
2. Токен NextAuth получает claim `sv` **один раз при входе** (в `jwt` при наличии `user` / `trigger==="update"`). Claim переживает перекодирование токена прокси и session-эндпоинтом (в отличие от `iat`, который Auth.js обновляет при каждом encode — поэтому сравнение по времени выдачи отвергнуто).
3. В полном `jwt`-callback (`src/lib/auth.ts`) на **каждом** вызове без `user` читается `getAuthState(userId)` (Redis `auth:state:{userId}` → при промахе БД → запись в Redis с `EX 60`):
   - пользователя нет или он влит (`mergedIntoUserId`) → `return null` (Auth.js v5 удаляет cookie, `auth()` → `null`);
   - `token.sv ?? 0 !== state.sessionVersion` → перечитать `role` и `adminSections` (через `getUserAdminSections`), записать `token.sv = state.sessionVersion`. Исключённый получает `role: USER`, `adminSections: []` → все админ-API 403, страницы `/admin/*` — forbidden;
   - сбой Redis и БД одновременно → fail-open (токен как есть) + `console.warn`; без БД приложение не работает в любом случае.
4. После коммита операции, сделавшей bump, сервис вызывает `publishAuthState(userId)` (Redis `SET … EX 60`). Если запись в Redis не удалась, TTL 60 с гарантирует, что устаревший кэш проживёт не дольше бюджета AC-A1.5. Токены, выпущенные до деплоя, не имеют `sv` → трактуются как `0` = дефолт колонки → массового разлогина нет.
5. **Прокси не меняем** (остаётся без БД/Redis — конвенция edge-совместимого `authConfig`). Закрываем «открытую вкладку»: клиентский `src/components/admin/session-watcher.tsx` в `src/app/admin/layout.tsx` дёргает `GET /api/auth/session` (полный `auth.ts`, не под matcher прокси) каждые 30 с и на `focus`/`visibilitychange`. Пустая сессия → `location.assign('/auth/signin?callbackUrl=…')`; изменились `role`/`adminSections` → `location.reload()`. Session-эндпоинт заодно перезаписывает cookie свежими claims, после чего и прокси видит новую роль.
   - Итоговые задержки: админ-API и server components с `auth()` — со следующего запроса (кэш публикуется синхронно); открытая вкладка — ≤ 30 с; server-rendered страница без собственного `auth()` при soft-навигации — ≤ 30 с (остаточное окно, укладывается в 60 с).
6. **Mini App:** `signWebAppToken` добавляет `sv`; `verifyWebAppToken` сверяет `sv` и `merged` через тот же `getAuthState` → при расхождении `null` (401). `TelegramProvider.apiFetch` на первый 401 один раз перевыпускает токен через `POST /api/webapp/auth` (свежий `initData`) и повторяет запрос. Исключённый получает токен с `role: USER`; `GET /api/webapp/notification-center` для бывшего сотрудника отвечает 403 «Доступ отозван». Staff-роуты по-прежнему перечитывают роль из БД (`loadWebAppStaff`).
7. **Бот:** staff-команды (`/settings`, legacy callbacks) уже читают роль из БД на каждое действие (`getTeamUser`) — немедленно. Вход «из бота» на сайт (`/api/internal/auth/bot-login-token`, провайдер `telegram-token`) выдаётся только `role: USER` и только невлитым — после исключения человек входит как клиент, это и требуется («может заново войти как обычный клиент»). Магик-ссылки и одноразовые коды создают **новую** сессию с текущими ролью и `sv`.

### Q2. Атомарность исключения при списках получателей в JSON

**Решение: выносим списки в таблицу `ModuleNotificationRecipient(moduleSlug, userId)`** с FK на `Module.slug` и `User.id` (обе `ON DELETE CASCADE`). Исключение — одна интерактивная `prisma.$transaction` с `SELECT … FOR UPDATE` целевого пользователя (и всех действующих SUPERADMIN, если цель — SUPERADMIN), внутри которой `deleteMany` по таблице. Гонки с RMW-записью `Module.config` в шести других местах исчезают: эти места больше не трогают получателей.

- Миграция копирует JSON в таблицу (SQL, §3), подменяя id влитых аккаунтов на primary и отбрасывая висячие id.
- Ключ `notificationRecipients` в JSON **не удаляется** в этом релизе (blue-green: старый контейнер несколько минут читает его). Новый код его не читает и не пишет. Удаление ключа — отдельная задача следующего релиза (правило «сначала add, потом remove», `agents/architect.md`).
- Конкурентная запись получателей админом во время исключения может вставить строку уже-USER-а — она инертна: резолвер на каждой рассылке перепроверяет роль и доступ (Q7).

### Q3. Хранение кликов, прочтений и пропусков

**Решение: реакции — колонки на строках уведомлений; клики внешних каналов — таблица ссылок; пропуски — отдельная таблица.**

| Данные | Где | Почему |
|---|---|---|
| Клик (первый + счётчик) по уведомлению из любого источника | `OutgoingNotification.clickedAt`, `.clickCount` (на **корне** цепочки) и `InAppNotification.clickedAt`, `.clickCount` | статистика — один проход по одной таблице; AC-D3.7 |
| Прочтение | существующий `readAt` + новый `readVia` (`open` — тап по карточке, `mark` — отметка по id, `bulk` — «Прочитать всё») | «Прочитать всё» не считается прочтением/реакцией (иначе медиана и доля реакции бессмысленны); `null` у старых строк = «прочтение до учёта» |
| Трекинг-ссылка внешнего канала | `NotificationLink` (код, цель, корень цепочки, индекс действия, клики) | цель хранится только на сервере (AC-D3.3) |
| Причина ошибки | `OutgoingNotification.failureCode` (нормализованный код) + `externalId` | человеческие причины (AC-D2.3), проблемы бота (AC-D4.1) |
| Пропуск (отправка не пыталась) | `NotificationDeliverySkip(userId, eventType, entity*, reason)` | AC-D4.3; только типы каталога (staff) |

Определения для статистики (закрепляют глоссарий PRD в коде):
- **Логическое уведомление** = цепочка `OutgoingNotification` с корнем `coalesce(fallbackOfId, id)` **или** строка `InAppNotification`.
- **Отправлено** = все логические уведомления; **Доставлено** = в цепочке есть `SENT` (`deliveredAt` = его `sentAt`), для `InAppNotification` — всегда (`deliveredAt = createdAt`); **В обработке** = есть `PENDING/DEFERRED` и нет `SENT`; **Ошибка** = иначе (включая `SKIPPED` по устареванию — `failureCode = STALE`). Тождество `Отправлено = Доставлено + Ошибки + В обработке` выполняется по построению.
- **Канал** цепочки = `kind` канала строки `SENT`, иначе последней строки; `InAppNotification` → `IN_APP` («Лента Mini App»).
- **Измеримое** = доставленное и (`IN_APP` или у корня есть хотя бы одна `NotificationLink`). Telegram/Push без ссылки → «реакцию измерить нельзя».
- **Реакция** (только у измеримых) = `min(readAt при readVia ≠ 'bulk', clickedAt)`; одна на уведомление. **Время до реакции** = `max(0, reactionAt − deliveredAt)`; медиана по реагировавшим; «без реакции за 24 ч» = доля измеримых, доставленных ≥ 24 ч назад, без реакции в пределах 24 ч.
- **Прочитано (лента)** = доставленные с `readAt` и `readVia ≠ 'bulk'` (для любого канала — все уведомления видны в ленте); в разрезе каналов колонка «прочитано» для Telegram/Push показывается с постоянной подписью AC-D1.4.
- В статистику входят только текущие члены команды (`role ∈ {SUPERADMIN, ADMIN, MANAGER}`, невлитые, не `system`) и только 12 типов каталога. Групповые чаты — отдельной строкой из легаси `NotificationLog` (`userId IS NULL`).

Объём и сроки: оценка ~200 staff-событий/сутки × ~3 личных получателя ≈ 600 строк/сутки → ~55 тыс. цепочек за 90 дней; ссылок ≤ 1 на уведомление в среднем; пропусков ≤ размера команды на событие. Агрегация на лету SQL-ом (§5.5), без предагрегатов. Хранение: `NotificationLink` — 400 дней (кнопки работают ≥ 12 мес., AC-D3.8), затем удаляются ежедневной уборкой → переход на главную; `NotificationDeliverySkip` — 180 дней; `OutgoingNotification`/`InAppNotification` — без изменений текущей политики (не чистятся). Окно статистики — до 90 дней.

### Q4. Трекинг-ссылки

- **Формат:** `${NEXT_PUBLIC_APP_URL}/r/{code}`, `code = crypto.randomBytes(16).toString("base64url")` (22 символа, 128 бит). Код не содержит и не позволяет вывести id пользователя/уведомления (AC-D3.5).
- **Цель** хранится только в `NotificationLink.targetUrl`; ссылка создаётся **при первой попытке доставки** (`deliverOne`) идемпотентно по `(outgoingId = корень цепочки, actionIndex)` — fallback-строка переиспользует те же коды. В payload строки остаются исходные URL (нужны ленте). Оборачиваются только события каталога и только внешние каналы (`TELEGRAM`, `PUSH`, `EMAIL`).
- **Белый список назначений** (`normalizeTrackableTarget`, §5.2): относительный путь `/…` (не `//`) → резолвится от `NEXT_PUBLIC_APP_URL`; абсолютный URL — только `https:` с origin = origin платформы, либо `https://t.me/<TELEGRAM_BOT_USERNAME>[/?]…`. Отклоняются `\`, управляющие символы, userinfo (`user@host`), прочие схемы и хосты. Неразрешённое действие не оборачивается и **не отправляется кликабельным** (кнопка выпадает из сообщения).
- **Редирект** `GET /r/{code}`: цель берётся только из БД и повторно прогоняется через белый список (defense in depth); любые query-параметры игнорируются (`?url=`, `?to=` и т.п. не читаются вообще). Неизвестный/битый/просроченный код → `302` на главную, без различия «есть/нет». Ответ `302`, `Cache-Control: no-store, private`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`. Ссылка никого не авторизует (AC-D3.9).
- **Не считать кликом:** `HEAD` (отвечаем тем же `302`, без записи), пустой `User-Agent`, UA ботов/превью/сканеров (регэксп §5.2), заголовки `Purpose: prefetch`, `Sec-Purpose: prefetch|prerender`. Inline-кнопки Telegram превью не генерируют.
- **Лимит:** существующий `rateLimit(request, "public")` (180/мин на доверенный IP, env `RATE_LIMIT_PUBLIC_PER_MIN`, уже поднят под CGNAT). Превышение → `302` на главную (не JSON-429), чтобы мобильная сеть за общим IP в худшем случае теряла запись клика, а не переход. Перебор 128-битных кодов невозможен независимо от лимита.
- **Сбой записи клика** (БД) не мешает переходу (AC-D3.2): запись в `try/catch`, редирект на цель, если код удалось прочитать.
- **Лента Mini App** редирект не использует (не уводим WebView на сайт): тап по карточке/кнопке → `POST /api/webapp/feed/open` (авторизованный, отмечает и прочтение, и клик как **одну** реакцию, AC-D3.10) fire-and-forget, навигация — как сейчас по исходному URL.
- **Кнопки `web_app`** в уведомлениях сейчас не используются; при появлении — клик фиксируется Mini App-ом тем же `feed/open`-подобным вызовом, редирект для них неприменим (зафиксировано, не реализуется).
- **Web Push:** `WebPushChannel` начинает класть в тело `url` = трекинг-ссылку первого действия (fallback `/admin/dashboard`) — это и фикс текущего бага (SW читает `data.url`), и измерение. `/r/…` same-origin, проверка SW проходит.

### Q5. Признак «бот запущен / заблокирован»

- **Хранение по Telegram-аккаунту, а не по пользователю:** `TelegramBotContact(telegramId @id, startedAt, startedBackfill, lastContactAt, lastDeliveryOkAt, blockedAt)`. Связь с пользователем — через `User.telegramId` (`@unique`). Обращение до привязки сохраняется и «подтягивается» автоматически (AC-E1.3); при слиянии с конфликтом Telegram у выжившего `telegramId` `startedAt = least(…)`.
- **Сигналы:**
  1. Middleware бота (первым в цепочке): любое `message`/`callback_query` в **личном** чате от не-бота → `recordBotContact` (`startedAt = coalesce(startedAt, now)`, `lastContactAt = now`). Группы игнорируются (AC-E1.2). Тексты не сохраняются (AC-E1.6). Троттлинг записи 10 мин в памяти процесса.
  2. `my_chat_member` в личном чате: `kicked` → `recordBotBlocked` (`blockedAt = now`); `member` → `recordBotContact` (разблокировал/перезапустил). `bot.start({ allowed_updates })` явно включает `my_chat_member`.
  3. Доставка: `TelegramChannel` нормализует ошибку в `failureCode` (`BOT_BLOCKED` ← «bot was blocked by the user»; `BOT_NOT_STARTED` ← «bot can't initiate conversation», «chat not found»; `USER_DEACTIVATED`; `NETWORK` ← транспорт/5xx/429; `OTHER`). Диспетчер: `BOT_BLOCKED` → `recordBotBlocked(address)`; успешная отправка → `recordDeliveryProof(address)` (`lastDeliveryOkAt`, троттлинг 1 ч условным upsert).
  4. Mini App: `initData.user.allows_write_to_pm === true` в `/api/webapp/auth` → `recordBotContact` (бот вправе писать — это и есть смысл флага для доставки).
- **Состояния** (`computeBotStatus`, одна функция для страницы, таблицы, блокировок, матрицы и проблем статистики — AC-E1.1): нет `telegramId` → «Telegram не привязан»; `blockedAt > max(lastContactAt, lastDeliveryOkAt)` → «Бот заблокирован» (дата блокировки хранится, снимается новым обращением — AC-E1.4); есть `startedAt` или `startedBackfill` или `lastDeliveryOkAt` → «Бот запущен ✓ <startedAt | дата неизвестна>»; иначе «Бот не запущен» + «Обращений к боту не зафиксировано с <trackingSince>».
- **Бэкфилл — SQL в миграции** (детерминирован, идемпотентен `ON CONFLICT DO NOTHING`, не требует ручного запуска на проде): `startedBackfill = true` для `telegramId`, у которых была успешная Telegram-доставка (`OutgoingNotification SENT` через канал `TELEGRAM`, легаси `NotificationLog SENT TELEGRAM` с `userId`) или вход через бота (`Account.provider='telegram-token'` / `source='telegram_bot'`). `trackingSince` = `MIN(TelegramBotContact.createdAt)` (= момент миграции).

### Q6. Правила объединения ролей, прав и подписок

Новый движок `src/modules/clients/merge.ts` (`previewAccountMerge`, `mergeAccounts`); `mergeClients`/`previewMerge` остаются тонкими обёртками (режим `clients_only`, прежние проверки «оба USER» и тексты ошибок) для `/api/admin/clients/merge*` и `autoMergeOnLogin`.

Правила (AC-E2.4):
- (а) итоговые роль и права = основного. У вторичного: `role → USER`, его `AdminPermission` и `ModuleAssignment` **удаляются, не переносятся** (в превью — «Не будут перенесены»), `sessionVersion + 1`, `mergedIntoUserId/mergedAt`.
- (б) если вторичный — SUPERADMIN, а основной нет: после слияния должен остаться ≥ 1 действующий SUPERADMIN, иначе `409 LAST_SUPERADMIN`. Повышения нет по построению (роль основного не меняется).
- (в) `NotificationEventPreference`: по совпадающему `eventType` побеждает основной, непересекающиеся переносятся (без доступа они инертны — резолвер проверяет доступ).
- (г) контакты: остаются значения основного; пустые поля основного заполняются из вторичного; значения вторичного при конфликте — в превью и `AuditLog`. **Порядок исправлен:** сначала освобождаем уникальные поля вторичного, потом заполняем основного (текущий код ловит `P2002`). Конфликт Telegram (у обоих разные `telegramId`) требует `confirmTelegramConflict: true`, иначе `409 TELEGRAM_CONFLICT_UNCONFIRMED`.
- (д) **сидер не меняем**; сидированный суперадмин (`telegramId === getSeededSuperadminTelegramId()`) не может быть вторичным: `409 SECONDARY_SEEDED_SUPERADMIN` «Этот аккаунт привязан к настройке сервера. Выберите его основным». Иначе следующий деплой создал бы нового SUPERADMIN.
- Вторичный ≠ текущий пользователь (`409 SECONDARY_IS_ACTOR`); оба невлиты (`409 ALREADY_MERGED`); у обоих ACTIVE-абонемент → блокер `409 ACTIVE_SUBSCRIPTION_CONFLICT` (частичный unique «один ACTIVE на userId»).
- **Списки получателей:** строки `ModuleNotificationRecipient` вторичного переписываются на основной с дедупликацией (AC-E2.6). Это не «права»: строка без доступа инертна.
- Переносятся дополнительно к текущему `mergeClients`: `Subscription`, `Chat.createdByUserId`, `ChatMessage.senderUserId`, `ChatParticipant` (дедуп по чату), `ChatMessageReceipt` (дедуп по сообщению), `InAppNotification`, `WebPushSubscription`, `NotificationDeliverySkip`, `NotificationLink.userId`, `MergeCandidate` (пара → `RESOLVED_MERGED`, прочие с участием вторичного → `DISMISSED`). `OutgoingNotification` дублирующих каналов **переадресуются** на канал основного (история не удаляется).
- `TelegramBotContact`: выживший `telegramId` получает `startedAt = least(оба)`, `blockedAt` — свой (актуальный).
- **Telegram-канал сотрудника (добавлено в PR #1157):** если `telegramId` вторичного переходит к основному с ролью ≠ USER, в той же транзакции делается `upsert` `UserNotificationChannel` TELEGRAM (форма как у `ensureTelegramChannel`; перенесённая на шаге 7 строка не трогается). Иначе флаг «Нет рабочего канала» держался до первого открытия Центра в Mini App. В превью — «Каналы второго (переносятся): Telegram», в `AuditLog` — `telegramChannelEnsured`. Способы входа вторичного (email+пароль, Telegram, VK, OAuth) переходят к основному, если у него их нет: человек входит ими в один аккаунт (AC-E2.6).
- Всё — одна интерактивная транзакция (`timeout 30s`) с `SELECT … FOR UPDATE` обеих строк в порядке id (параллельное слияние → второе получает `409 ALREADY_MERGED`, частичных изменений нет — AC-E2.7). После коммита — `publishAuthState(secondary)` (сессии вторичного отозваны; сессия основного не трогается — AC-E2.9).

### Q7. Единый расчёт «кто получает»

**Решение: чистая функция правил `evaluateRoute` + один DB-резолвер `resolveStaffRouting`, которые используют и рассылка, и все экраны.**

- `src/modules/notifications/audience-rules.ts` — leaf без БД: `contextAccess`, `evaluateRoute`, `groupChatDecision` (разделы — через `computeAdminSections` из `permissions.ts`).
- `src/modules/notifications/audience.ts` — загрузка снимков (пользователи + гранты + назначения + предпочтения + строки списков + конфиг модулей) батчем и применение правил:
  - `resolveStaffRouting({ eventType, moduleSlug, staffAudience })` → `{ recipients: [{userId, paths}], suppressed: [{userId, reason:"OPTED_OUT"}], groupChat }` — вызывается из `notifyAdmin`, Авито, релизов, сводки звонков;
  - `explainStaffNotifications(userIds)` — тот же `evaluateRoute` по всем событиям каталога × контекстам модулей → экраны C1 (страница), C4 (матрица), Центр Mini App, таблица «Команда».
- Контексты событий — статическая карта в `catalog.ts` (реальные `moduleSlug`, с которыми событие уходит в `notifyAdmin`): `booking.*` → `gazebos`, `ps-park`; `order.*` → `cafe`; `contract.*` → `rental`; `inquiry.created` → `rental-inquiry`; `payment.*` → `gazebos`, `ps-park`, `cafe`; `avito.lead.new` → `gazebos`, `ps-park`, `null`; `system.release`, `telephony.daily_summary` → `null`. Тест держит инвариант «каждый тип каталога имеет ≥ 1 контекст».
- **Правило доступа** `contextAccess(user, category, moduleSlug, path)` (одно для всех путей):
  1. `role = USER` или влит → нет («Не входит в команду»);
  2. `category.superadminOnly` и не SUPERADMIN → нет («Только для суперадмина»);
  3. `moduleSlug` строгий (`nedelovoy`) без явного гранта → нет («Нужен явный доступ к «НеДеловой»»);
  4. `category.staffAlways` (новый флаг, только `system`) → да;
  5. хотя бы одна секция категории ∈ `computeAdminSections(role, grants)` (SUPERADMIN — все нестрогие) или `superadminAlways` и SUPERADMIN → да;
  6. назначение `ModuleAssignment` на модуль контекста (алиас `rental-inquiry → rental`) → да;
  7. путь `module_list` и роль `ADMIN` → да (сохраняет текущее правило допуска в список: SUPERADMIN/ADMIN/MANAGER-с-назначением);
  8. иначе нет («Нет доступа к разделу «<label>»»).
- **Пути** (каждый требует `contextAccess`): `personal` — строка `enabled=true`; `module_list` — строка в `ModuleNotificationRecipient(moduleSlug)` и нет явного `false`; `role_avito` — `avito.lead.new`: SUPERADMIN или MANAGER/ADMIN с назначением на модуль лида, нет явного `false`; `in_app_superadmin` — `telephony.daily_summary`: SUPERADMIN, нет явного `false` (`defaultEnabled`). **Явное `enabled=false` перекрывает все пути** (AC-C2.1); явное `true` добавляет путь `personal` без членства в списке. Пользователь с несколькими путями получает одно сообщение (дедуп по `userId` в резолвере, AC-C1.3).
- `staffAudience: "personal"` → в `recipients` только путь `personal` (как сейчас).
- **Групповой чат** (`groupChatDecision`) — ровно текущая логика `notifyAdmin`: не `personal`, не `telegramAdminChatEnabled === false`, **в списке модуля 0 строк** (сырых, как и сейчас считалось по JSON), есть чат модуля или глобальный. Эту же функцию показывает строка «Общий чат раздела получает это событие: да/нет» (AC-C1.7).
- Существующие настройки разделов не ломаются: список модулей копируется миграцией 1:1, групповой режим вычисляется так же. Изменения поведения (в release notes): демотированные/влитые перестают получать по списку и Авито; Авито «Вкл» теперь добавляет получателя; категория «Системные» доступна любому сотруднику (как и реальная доставка релизов сегодня); «grandfather»-видимость категорий без доступа в Центре убрана (без доступа доставки нет, ловушки «получаю, но не могу отключить» больше не существует); SUPERADMIN можно включать в список модуля (надпись «всегда получают» убрана).

### Q8. Ключ подписки сотрудника и клиента

**Не разводим.** Клиентский путь (`notifyClient`) использует только легаси `NotificationPreference.enable*` и `channels/*`; `dispatch()` с типами каталога вызывается только для сотрудников. Значит строка `NotificationEventPreference(userId, booking.created)` по факту — staff-подписка. Фиксируем инвариант: (1) комментарий в `catalog.ts`; (2) тест `catalog.test.ts`: в `src/**` нет вызовов `dispatch(` с литералами типов каталога вне staff-путей (`notifications/service.ts#notifyAdmin`, Авито, `release-notify.ts`), и `notifyClient` не читает `notificationEventPreference`. При исключении строки по типам каталога **удаляются** (решение PO, AC-A1.4) — клиентские уведомления этим не затрагиваются. Если когда-либо клиентский путь переедет на `dispatch()`, он обязан использовать отдельное пространство имён (`client.booking.created`).

### Q9. Самопривязка к аккаунтам сотрудников

**Подтверждаем предложение PO с уточнением механики:**
- **OTP по email к SUPERADMIN-аккаунту запрещён.** Чтобы не раскрыть существование аккаунта (AC-E3.3), API отвечает тем же общим текстом, кода не генерирует, а на email суперадмина уходит информационное письмо «Привязку Telegram к этому аккаунту выполняет суперадмин: войдите на сайт и используйте „Привязать Telegram“ в профиле». Так AC-E3.7 доносится до владельца адреса, а не до запрашивающего.
- **ADMIN/MANAGER/USER — разрешено** с записью в журнал.
- **Что происходит после верного кода:** Mini App к этому моменту уже создал по `telegramId` аккаунт («TG-аккаунт»). Если TG-аккаунт — **одноразовая оболочка** (`role=USER`, невлит, нет email и пароля, нет «истории»: броней, заказов, абонементов, задач, чатов, обратной связи — по реестру блокеров удаления §5.1 без «служебных» типов), выполняется `mergeAccounts(mode: "self_link", primary = email-аккаунт, secondary = TG-аккаунт, actor = primary)`. Человек доказал владение обеими идентичностями (подпись `initData` + код из письма), а переносить нечего — это безопасно. Иначе (у TG-аккаунта есть история или у email-аккаунта уже другой Telegram) — **запрос на объединение** для SUPERADMIN и ответ AC-E4.1. Запросы создаются **только после верного кода** — посторонний не может засыпать очередь запросами против чужого email.
- **Deep-link из вошедшей сессии** (`/api/profile/telegram/generate-link` → бот `link_…`) разрешён для всех ролей, включая SUPERADMIN (владение аккаунтом доказано сессией). При конфликте — та же логика: оболочка сливается, иначе запрос + сообщение AC-E4.1.
- Вход сотрудников через бота на сайт остаётся запрещён (`ADMIN_NO_BOT_LOGIN`) — не меняем.

### Q10. Единый источник «какие разделы доступны»

`getUserAdminSections` становится единственным источником для JWT (`auth.ts` перестаёт дублировать логику), прокси (через токен), Центра, C1, матрицы, витрины «Для команды». Чистая `computeAdminSections(role, grants)`:
- SUPERADMIN — все нестрогие разделы + строгие по явному гранту;
- **ADMIN — явные гранты ∪ `ADMIN_EDITABLE_MODULES` (gazebos, ps-park, inventory)** — приводим страницы к уже действующей API-политике «admin fully owns Барбекю Парк, Плей Парк и Склад»;
- MANAGER — явные гранты; всем, кроме SUPERADMIN, — без `telephony`.

Намеренного ограничения выдачи разделов ADMIN в коде не найдено (сервер отклонял их той же веткой, что и для SUPERADMIN, — следствие развилки «только MANAGER = полная замена»), поэтому AC-A4.5 реализуем. Известная несостыковка, которую **не** трогаем (вне скоупа, заводится issue): `requireAdminSection` пускает ADMIN во все нестрогие API-разделы по роли. Миграция делает `sessionVersion + 1` всем ADMIN — их токены обновят разделы на следующем запросе (без разлогина).

### Q11. Производительность и «последний вход»

- **«Последний вход»** — новая колонка `User.lastLoginAt`: пишется в `events.signIn` полного `auth.ts` (все провайдеры NextAuth: пароль, магик-ссылка, `telegram-token`, VK) и в `/api/webapp/auth` (открытие Mini App). Бэкфилл в миграции: `MAX(AuditLog.createdAt) WHERE action='auth.signin.success'`. Вход по email поддерживается.
- **Таб «Команда»** (≤ 50 человек, AC-B2.6 < 2 с): один сервисный вызов, 7 батч-запросов (пользователи команды; гранты; назначения; каналы; предпочтения по типам каталога; строки списков; бот-контакты по `telegramId`) + чистые функции. O(50 × 12 × контексты). Цель < 400 мс.
- **Страница сотрудника** (AC-B1.9 < 2 с): три параллельных запроса клиента (`overview`, `notifications`, `notification-stats`), каждый ≤ 6 запросов в БД.
- **Статистика 90 дней** (AC-D1.10 < 3 с): один SQL с CTE цепочек и `GROUPING SETS` (§5.5) по индексу `OutgoingNotification(userId, createdAt)`; оценка 55 тыс. цепочек — < 500 мс; при ×10 объёма — < 3 с. Предагрегаты не нужны. Кэша нет (данные должны меняться сразу).

### Q12. Нарезка поставки

**Один PR** (`claude/team-access-notifications`), фазы — отдельными коммитами в порядке §11. Порядок выбран так, чтобы запись данных, которые нельзя восстановить задним числом (клики, пропуски, бот), появилась в том же релизе, что и блок A. Разносить на несколько PR не предлагаю: самая рискованная часть (отзыв сессий) — фундамент блока A, а смена маршрутизации покрыта контрольным тестом паритета. Синк таблицы модулей CLAUDE.md — в этом же PR (§13). Could-история D4.4 (график, CSV) в PR не входит; все Must и Should — входят.

---

## 2. Варианты по ключевым развилкам (кратко)

| Развилка | Вариант A | Вариант B | Выбор |
|---|---|---|---|
| Отзыв сессий | `sessionVersion` + проверка в полном `jwt` + watcher | database-сессии Auth.js | **A**: Credentials-провайдеры Auth.js требуют JWT-стратегию; B — переписывание входа и запрос в БД на каждый запрос |
| Списки получателей | таблица с FK | `jsonb_set` в транзакции | **A**: B не защищает от RMW шести других писателей, нет FK и каскада, слияние оставляет висячие id |
| Реакции | колонки на строках + таблица ссылок | журнал событий реакций (строка на каждое чтение/клик) | **A**: AC требуют первый клик + счётчик; B — лишний объём и джойны |
| Трекинг | серверный реестр кодов | самоподписанный токен с целью внутри (HMAC) | **A**: в B адрес едет в ссылке (класс open-redirect), нельзя отозвать |
| Признак бота | таблица по `telegramId` | колонки на `User` | **A**: B теряет обращения до привязки (AC-E1.3) |
| OTP-привязка | слияние только «оболочки», иначе запрос | автослияние любого TG-аккаунта | **A**: B позволяет поглотить чужую историю по одному письму |

---

## 3. Схема данных и миграция

Каталог миграции: **`prisma/migrations/20261025120000_team_access_notifications/migration.sql`**. Только аддитивно (ADD COLUMN / CREATE TABLE / CREATE INDEX / INSERT-бэкфилл / UPDATE нового поля). Ничего не удаляется.

### 3.1 Prisma (изменения `prisma/schema.prisma`)

```prisma
model User {
  // ... существующие поля
  sessionVersion Int       @default(0) // bump = отзыв всех сессий (ADR 2026-10-25 §Q1)
  lastLoginAt    DateTime? // последний успешный вход (сайт или Mini App)

  // ... существующие связи
  notificationRecipientOf ModuleNotificationRecipient[] @relation("ModuleRecipientUser")
}

model Module {
  // ... существующие поля
  notificationRecipientRows ModuleNotificationRecipient[]
}

/// Списки получателей уведомлений раздела (было: Module.config.notificationRecipients).
/// Ключ JSON сохранён на один релиз для blue-green, не читается.
model ModuleNotificationRecipient {
  moduleSlug      String
  userId          String
  createdByUserId String?
  createdAt       DateTime @default(now())

  module Module @relation(fields: [moduleSlug], references: [slug], onDelete: Cascade, onUpdate: Cascade)
  user   User   @relation("ModuleRecipientUser", fields: [userId], references: [id], onDelete: Cascade)

  @@id([moduleSlug, userId])
  @@index([userId])
}

model NotificationEventPreference {
  // ... существующие поля
  updatedByUserId String? // последний актор (AC-C2.3); plain column, без FK
  updatedVia      String? // "admin" | "miniapp" | "matrix" | "system"
}

model OutgoingNotification {
  // ... существующие поля
  failureCode String?   // BOT_BLOCKED | BOT_NOT_STARTED | USER_DEACTIVATED | NETWORK | CHANNEL_UNAVAILABLE | CHANNEL_EXPIRED | CHANNEL_AUTH | STALE | OTHER
  externalId  String?   // message_id Telegram / Location push-сервиса
  clickedAt   DateTime? // первый клик (только на корне цепочки)
  clickCount  Int       @default(0)
  readVia     String?   // "open" | "mark" | "bulk"

  links NotificationLink[]

  @@index([fallbackOfId])
}

model InAppNotification {
  // ... существующие поля
  clickedAt  DateTime?
  clickCount Int       @default(0)
  readVia    String?
}

/// Трекинг-ссылка внешнего канала. Цель только здесь (AC-D3.3).
model NotificationLink {
  id           String    @id @default(cuid())
  code         String    @unique // 22 символа base64url, 128 бит
  outgoingId   String    // корень цепочки OutgoingNotification
  actionIndex  Int
  userId       String    // plain column (как OutgoingNotification.userId)
  eventType    String
  targetUrl    String    @db.Text
  createdAt    DateTime  @default(now())
  expiresAt    DateTime  // createdAt + 400 дней
  firstClickAt DateTime?
  lastClickAt  DateTime?
  clickCount   Int       @default(0)

  outgoing OutgoingNotification @relation(fields: [outgoingId], references: [id], onDelete: Cascade)

  @@unique([outgoingId, actionIndex])
  @@index([expiresAt])
  @@index([userId, createdAt])
}

/// Пропуск доставки (отправка не пыталась) — только типы каталога (AC-D4.3).
model NotificationDeliverySkip {
  id         String   @id @default(cuid())
  userId     String   // plain column
  eventType  String
  entityType String?
  entityId   String?
  reason     String   // DUPLICATE | PREFERENCE_DISABLED | OPTED_OUT | DND | NO_CHANNEL
  createdAt  DateTime @default(now())

  @@index([userId, createdAt])
  @@index([createdAt])
}

/// Контакт Telegram-аккаунта с ботом; существует и до привязки к User (AC-E1.3).
model TelegramBotContact {
  telegramId       String    @id
  startedAt        DateTime? // первое обращение в личном чате; не перезаписывается
  startedBackfill  Boolean   @default(false) // «запущен (дата неизвестна)»
  lastContactAt    DateTime?
  lastDeliveryOkAt DateTime?
  blockedAt        DateTime? // дата последней блокировки; сохраняется после разблокировки
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
}
```

`MergeCandidate` не меняется: запросы на объединение (US-E4) — его строки с `matchedFields = ["telegramId"]`, `matchScore = 1`, пары упорядочены `sortPair` (как в `autoMergeOnLogin`). «Это разные люди» → `status = "RESOLVED_KEPT_SEPARATE"`.

### 3.2 SQL миграции (полный текст, порядок обязателен)

```sql
-- ADR 2026-10-25-team-access-notifications. Только аддитивно.

-- 1. User: версия сессии и последний вход
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

UPDATE "User" u SET "lastLoginAt" = s."last"
FROM (
  SELECT "userId", MAX("createdAt") AS "last"
  FROM "AuditLog" WHERE "action" = 'auth.signin.success'
  GROUP BY "userId"
) s
WHERE s."userId" = u."id";

-- ADMIN получает разделы по роли (Q10): освежить claims токенов без разлогина
UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE "role" = 'ADMIN';

-- 2. Последний актор подписки
ALTER TABLE "NotificationEventPreference" ADD COLUMN "updatedByUserId" TEXT;
ALTER TABLE "NotificationEventPreference" ADD COLUMN "updatedVia" TEXT;

-- 3. Диагностика доставки и реакции
ALTER TABLE "OutgoingNotification" ADD COLUMN "failureCode" TEXT;
ALTER TABLE "OutgoingNotification" ADD COLUMN "externalId" TEXT;
ALTER TABLE "OutgoingNotification" ADD COLUMN "clickedAt" TIMESTAMP(3);
ALTER TABLE "OutgoingNotification" ADD COLUMN "clickCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OutgoingNotification" ADD COLUMN "readVia" TEXT;
CREATE INDEX "OutgoingNotification_fallbackOfId_idx" ON "OutgoingNotification"("fallbackOfId");

ALTER TABLE "InAppNotification" ADD COLUMN "clickedAt" TIMESTAMP(3);
ALTER TABLE "InAppNotification" ADD COLUMN "clickCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InAppNotification" ADD COLUMN "readVia" TEXT;

-- 4. Списки получателей разделов: таблица + перенос из JSON
CREATE TABLE "ModuleNotificationRecipient" (
    "moduleSlug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModuleNotificationRecipient_pkey" PRIMARY KEY ("moduleSlug", "userId")
);
CREATE INDEX "ModuleNotificationRecipient_userId_idx" ON "ModuleNotificationRecipient"("userId");
ALTER TABLE "ModuleNotificationRecipient" ADD CONSTRAINT "ModuleNotificationRecipient_moduleSlug_fkey"
    FOREIGN KEY ("moduleSlug") REFERENCES "Module"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModuleNotificationRecipient" ADD CONSTRAINT "ModuleNotificationRecipient_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ModuleNotificationRecipient" ("moduleSlug", "userId")
SELECT DISTINCT m."slug", COALESCE(u."mergedIntoUserId", u."id")
FROM "Module" m
CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(m."config"->'notificationRecipients') = 'array'
         THEN m."config"->'notificationRecipients' ELSE '[]'::jsonb END
) AS r("uid")
JOIN "User" u ON u."id" = r."uid"
ON CONFLICT DO NOTHING;

-- 5. Трекинг-ссылки
CREATE TABLE "NotificationLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "outgoingId" TEXT NOT NULL,
    "actionIndex" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "firstClickAt" TIMESTAMP(3),
    "lastClickAt" TIMESTAMP(3),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "NotificationLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationLink_code_key" ON "NotificationLink"("code");
CREATE UNIQUE INDEX "NotificationLink_outgoingId_actionIndex_key" ON "NotificationLink"("outgoingId", "actionIndex");
CREATE INDEX "NotificationLink_expiresAt_idx" ON "NotificationLink"("expiresAt");
CREATE INDEX "NotificationLink_userId_createdAt_idx" ON "NotificationLink"("userId", "createdAt");
ALTER TABLE "NotificationLink" ADD CONSTRAINT "NotificationLink_outgoingId_fkey"
    FOREIGN KEY ("outgoingId") REFERENCES "OutgoingNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Пропуски доставки
CREATE TABLE "NotificationDeliverySkip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationDeliverySkip_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NotificationDeliverySkip_userId_createdAt_idx" ON "NotificationDeliverySkip"("userId", "createdAt");
CREATE INDEX "NotificationDeliverySkip_createdAt_idx" ON "NotificationDeliverySkip"("createdAt");

-- 7. Контакт с ботом + бэкфилл «запущен (дата неизвестна)» (AC-E1.5)
CREATE TABLE "TelegramBotContact" (
    "telegramId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "startedBackfill" BOOLEAN NOT NULL DEFAULT false,
    "lastContactAt" TIMESTAMP(3),
    "lastDeliveryOkAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramBotContact_pkey" PRIMARY KEY ("telegramId")
);

INSERT INTO "TelegramBotContact" ("telegramId", "startedBackfill", "updatedAt")
SELECT DISTINCT x."tg", true, CURRENT_TIMESTAMP
FROM (
    SELECT c."address" AS "tg"
    FROM "OutgoingNotification" o
    JOIN "UserNotificationChannel" c ON c."id" = o."channelId"
    WHERE c."kind" = 'TELEGRAM' AND o."status" = 'SENT'
  UNION
    SELECT u."telegramId"
    FROM "User" u
    WHERE u."telegramId" IS NOT NULL AND (
         u."source" = 'telegram_bot'
      OR EXISTS (SELECT 1 FROM "Account" a WHERE a."userId" = u."id" AND a."provider" = 'telegram-token')
      OR EXISTS (SELECT 1 FROM "NotificationLog" l
                 WHERE l."userId" = u."id" AND l."channel" = 'TELEGRAM' AND l."status" = 'SENT')
    )
) x
WHERE x."tg" ~ '^[0-9]+$'
ON CONFLICT ("telegramId") DO NOTHING;
```

Почему бэкфилл в SQL, а не скриптом: детерминированная однократная операция над уже существующими данными; CI drift-check проверяет миграцию на реальной БД; не требует ручного запуска на проде и не попадает в оркестрированные сидеры (которые бегут на каждом деплое).

### 3.3 Откат

Миграция аддитивна → откат кода безопасен, новые таблицы просто перестают использоваться. Единственное расхождение после отката — списки получателей, изменённые после деплоя (они только в таблице). Контингентный SQL (выполняется только при откате, описан здесь, автоматики нет):

```sql
UPDATE "Module" m SET "config" = jsonb_set(COALESCE(m."config", '{}'::jsonb), '{notificationRecipients}',
  COALESCE((SELECT jsonb_agg(r."userId") FROM "ModuleNotificationRecipient" r WHERE r."moduleSlug" = m."slug"), '[]'::jsonb));
```

---

## 4. Общие типы и ошибки

`src/modules/users/errors.ts`, `src/modules/notifications/errors.ts`, `src/modules/clients/merge-errors.ts` — по образцу `CenterError`:

```ts
export class DomainError extends Error {
  constructor(readonly code: string, message: string,
              readonly status: 400 | 403 | 404 | 409 | 410 | 422 | 429 | 502 | 503,
              readonly metadata?: Record<string, unknown>) { super(message); }
}
```
Роуты мапят `DomainError` → `apiError(code, message, status, metadata)`; прочее → `apiServerError()` без деталей. Тексты ошибок — по-русски, без внутренних id и технических кодов в `message`.

| code | status | message |
|---|---|---|
| `CANNOT_EXCLUDE_SELF` | 400 | Нельзя исключить самого себя |
| `CANNOT_DEMOTE_SELF` | 400 | Нельзя понизить роль самому себе |
| `LAST_SUPERADMIN` | 409 | Нельзя исключить последнего суперадмина. Сначала назначьте другого |
| `NOT_IN_TEAM` | 409 / 422 | Пользователь не входит в команду (409 — исключение; 422 — подписки/права) |
| `ALREADY_EXCLUDED` | 409 | Пользователь уже не входит в команду |
| `SEEDED_SUPERADMIN_CONFIRM_REQUIRED` | 409 | Этот аккаунт назначен суперадмином в настройках сервера… (текст PRD), `metadata: { requiresConfirmation: "seeded_superadmin" }` |
| `USER_HAS_HISTORY` | 409 | Удалить нельзя: у аккаунта есть история…, `metadata: { blockers: [{type,label,count}], isTeamMember }` |
| `USER_NOT_FOUND` | 404 | Пользователь не найден |
| `USER_MERGED` | 409 | Этот аккаунт объединён с другим, `metadata: { primaryUserId }` |
| `UNKNOWN_EVENT` | 422 | Неизвестный тип уведомления |
| `NO_ACCESS_TO_CATEGORY` | 422 | Нет доступа к разделу «…» |
| `SECTION_NOT_GRANTABLE` | 422 | Раздел «Звонки» доступен только суперадмину / Неизвестный раздел |
| `ALREADY_MERGED` | 409 | Этот аккаунт уже объединён с другим |
| `SECONDARY_IS_ACTOR` | 409 | Нельзя объединить аккаунт, под которым вы вошли. Выберите его основным |
| `SECONDARY_SEEDED_SUPERADMIN` | 409 | Этот аккаунт привязан к настройке сервера. Выберите его основным |
| `TELEGRAM_CONFLICT_UNCONFIRMED` | 409 | У аккаунтов разные Telegram — подтвердите, какой оставить |
| `ACTIVE_SUBSCRIPTION_CONFLICT` | 409 | У обоих аккаунтов активный абонемент — объединение невозможно, пока один не завершён |
| `SAME_ACCOUNT` | 422 | Нельзя объединить аккаунт сам с собой |
| `TELEGRAM_IN_USE_MERGE_REQUESTED` | 409 | Этот Telegram уже используется в другом аккаунте. Мы передали запрос администратору — он объединит аккаунты. Пока вы можете пользоваться текущим аккаунтом |
| `PHONE_LINK_UNAVAILABLE` | 422 | Привязка по телефону пока недоступна |
| `OTP_DELIVERY_UNAVAILABLE` | 503 | Не удалось отправить код. Попробуйте позже или обратитесь к администратору |
| `OTP_SEND_FAILED` | 502 | (тот же текст) |
| `LINK_BLOCKED` / `INVALID_CODE` / `CODE_EXPIRED` | 429 / 400 / 410 | как сейчас |

---

## 5. Сервисы (по модулям)

### 5.0 `src/lib` (общая инфраструктура)

**`src/lib/seeded-superadmin.ts`** (leaf, используется и сидером `scripts/seeds/core.ts`, и приложением — одно место правды):
```ts
export function getSeededSuperadminTelegramId(env?: NodeJS.ProcessEnv): string; // env.SUPERADMIN_TELEGRAM_ID ?? текущий fallback из core.ts
export function isSeededSuperadmin(user: { telegramId: string | null }): boolean;
```

**`src/lib/session-revocation.ts`:**
```ts
export type AuthState = { sessionVersion: number; role: Role; merged: boolean };
export async function getAuthState(userId: string): Promise<AuthState | null | "unavailable">; // Redis auth:state:{id} (EX 60) → БД
export async function bumpSessionVersion(tx: Prisma.TransactionClient, userId: string): Promise<number>; // UPDATE … RETURNING
export async function publishAuthState(userId: string): Promise<void>; // после коммита: БД → Redis SET EX 60; ошибки глотаются
```

**`src/lib/permissions.ts`:** добавить чистую `computeAdminSections(role: Role, grants: string[]): string[]`; `getUserAdminSections` = загрузка `role` + `AdminPermission` → `computeAdminSections`. Добавить чистую `getGrantableSections(role: Role): { roleSections: string[]; grantableSections: string[]; strictSections: string[] }`:
- SUPERADMIN: `roleSections` = все нестрогие разделы (только чтение), `grantableSections` = `[]`, `strictSections` = `["nedelovoy"]`;
- ADMIN: `roleSections` = `ADMIN_EDITABLE_MODULES`, `grantableSections` = прочие нестрогие, кроме `telephony`, `strictSections` = `["nedelovoy"]`;
- MANAGER: `roleSections` = `[]`, `grantableSections` = все нестрогие, кроме `telephony`, `strictSections` = `["nedelovoy"]`;
- USER: все списки пусты.

**`src/lib/auth.ts`:** `jwt` — алгоритм Q1 (п. 2–3), разделы — только через `getUserAdminSections`; `events.signIn` — `prisma.user.update({ lastLoginAt: new Date() })` best-effort. **`src/lib/auth.config.ts`:** в `JWT` добавить `sv?: number`; edge-`jwt` переносит claim без изменений.

**`src/lib/webapp-auth.ts`:** `signWebAppToken({ sub, telegramId, role, sv })`; `verifyWebAppToken` после проверки подписи → `getAuthState(sub)`: `null`/`merged`/`sv` не совпал → `null`; `"unavailable"` → пропустить (fail-open, как в NextAuth).

**`src/modules/notifications/channels/email.ts`:** `TransactionalEmailParams.sensitive?: boolean` — при `true` и без SMTP возвращает `{ success: false, error: "SMTP_NOT_CONFIGURED" }` и **не логирует тело**; при ошибке отправки логирует только сообщение транспорта. Добавить `isTransactionalEmailConfigured(): boolean`.

### 5.1 `users`

Файлы: `service.ts` (остаётся), новые `exclusion.ts`, `deletion-blockers.ts`, `team.ts`, `errors.ts`, расширение `types.ts`, `validation.ts`.

**`exclusion.ts`:**
```ts
export async function getExclusionPreview(targetId: string, actorId: string): Promise<ExclusionPreview>;
export async function excludeFromTeam(targetId: string, actorId: string,
  opts: { confirmSeeded?: boolean; via: "exclude" | "role_change" }): Promise<ExclusionResult>;
export async function changeUserRole(targetId: string, newRole: Role, actorId: string,
  opts: { confirmSeeded?: boolean }): Promise<ChangeRoleResult>;
```

Алгоритм `excludeFromTeam` (одна `prisma.$transaction(async tx => …, { timeout: 15_000 })`):
```
if targetId === actorId → CANNOT_EXCLUDE_SELF
lock: SELECT id, role, "telegramId", "mergedIntoUserId" FROM "User" WHERE id = $target FOR UPDATE
user missing → USER_NOT_FOUND; merged → USER_MERGED
role = USER → (есть AuditLog user.team.exclude по entityId) ? ALREADY_EXCLUDED : NOT_IN_TEAM   // без записи в журнал
if role = SUPERADMIN:
  SELECT id FROM "User" WHERE role='SUPERADMIN' AND "mergedIntoUserId" IS NULL AND id <> 'system' FOR UPDATE
  others = all - target; others.length = 0 → LAST_SUPERADMIN
if isSeededSuperadmin(user) && !opts.confirmSeeded → SEEDED_SUPERADMIN_CONFIRM_REQUIRED
before = { sections: AdminPermission[], modules: ModuleAssignment→slug[], lists: ModuleNotificationRecipient→slug[],
           subscriptions: NEP where eventType ∈ MANAGED_EVENT_TYPES → eventType[] }
tx.user.update({ role: USER }); bumpSessionVersion(tx, target)
tx.adminPermission.deleteMany({ userId }); tx.moduleAssignment.deleteMany({ userId })
tx.moduleNotificationRecipient.deleteMany({ userId })
tx.notificationEventPreference.deleteMany({ userId, eventType: { in: MANAGED_EVENT_TYPES } })
tx.notificationPreference.updateMany({ where: { userId }, data: { notifyReleases: false } })
tx.auditLog.create({ userId: actor, action: "user.team.exclude", entity: "User", entityId: target,
  metadata: { previousRole, via, removed: before, seededSuperadmin, confirmedSeeded } })   // без email/телефона
commit → publishAuthState(target)
```
Не трогаются (AC-A1.4): `UserNotificationChannel` (включая Telegram и Push), `NotificationPreference.enable*`, брони, заказы, абонементы, задачи, чаты, журнал, `TaskSubscription`.

`changeUserRole`: `newRole = USER` и старая роль ∈ команде → `excludeFromTeam(via: "role_change")`; понижение (ранг SUPERADMIN 3 > ADMIN 2 > MANAGER 1) → в транзакции update роли + `bumpSessionVersion` + аудит `user.role.change { oldRole, newRole, demotion: true }`, гарды: себя (`CANNOT_DEMOTE_SELF`), последний SUPERADMIN (если понижается SUPERADMIN), сидированный SUPERADMIN → требует `confirmSeeded`; повышение — как сейчас (MANAGER: `dashboard`; MANAGER/SUPERADMIN из не-сотрудника: `ensureManagerNotifyDefaults`), аудит. `updateUser` делегирует смену роли сюда.

`ExclusionPreview`:
```ts
{ user: { id, name, role }, isSeededSuperadmin: boolean,
  removes: { sectionsByRole: string[]; explicitSections: string[]; modules: string[]; recipientLists: string[]; subscriptions: string[] },
  counts: { sections: number; modules: number; recipientLists: number; subscriptions: number },
  openAssignedTasks: number,   // TaskAssignee, task.closedAt = null AND task.deletedAt = null
  guard: null | { code: "CANNOT_EXCLUDE_SELF" | "LAST_SUPERADMIN" | "NOT_IN_TEAM" | "ALREADY_EXCLUDED"; message: string } }
```

**`deletion-blockers.ts`** — реестр RESTRICT-связей с подписями (порядок вывода):
```ts
export const DELETION_BLOCKERS: Array<{ type: string; label: string; tables: string[];
  count: (db: PrismaClient | Prisma.TransactionClient, userId: string) => Promise<number> }>;
// AuditLog «Журнал действий»; ModuleAssignment «Назначения на модули»; TaskAssignee «Задачи»;
// FeedbackItem «Обратная связь»; Subscription «Абонементы Плей Парка»;
// Chat(createdBy)+ChatParticipant+ChatMessage+ChatMessageReceipt → одна строка «Чаты и сообщения» (сумма);
// MergeCandidate(primary|candidate) «Кандидаты на объединение»;
// OutgoingNotification через UserNotificationChannel пользователя «Доставленные уведомления».
export async function getDeletionBlockers(userId: string): Promise<Array<{ type: string; label: string; count: number }>>; // только count > 0
export const SHELL_IGNORED_BLOCKERS: Set<string>; // AuditLog, OutgoingNotification, MergeCandidate — «служебные» для isDisposableTelegramShell
```
Тест (§10) парсит миграции и требует, чтобы **каждая** последняя по имени FK `REFERENCES "User"("id") ON DELETE RESTRICT` (и `NO ACTION`) была покрыта реестром (`tables`) — новый RESTRICT-FK без строки реестра роняет CI.

`deleteUser(id, actorId)`: гарды как сейчас → `getDeletionBlockers` → непусто → `USER_HAS_HISTORY` (metadata с блокерами и `isTeamMember`) → иначе удаление + `AuditLog user.delete` (metadata `{ role }`). `P2003` в гонке → повторный расчёт блокеров → `USER_HAS_HISTORY` (если пусто — блокер «Связанные записи — 1» с общим текстом, AC-A3.2).

**`team.ts`:**
```ts
export async function getTeamOverview(q: TeamOverviewQuery): Promise<{ rows: TeamOverviewRow[]; pendingMergeRequests: number }>;
export async function getUserOverview(userId: string): Promise<UserOverview>;
export async function isDisposableTelegramShell(userId: string, db?: Prisma.TransactionClient): Promise<boolean>;
```
`TeamOverviewRow` и `UserOverview` — §6 (контракты). Флаги строки: `NO_WORKING_CHANNEL` (есть маршрут по ≥ 1 событию с внешней доставкой, но нет доставляемого канала), `BOT_NOT_STARTED`, `BOT_BLOCKED`, `STALE_LOGIN` (`lastLoginAt` старше 90 дней или `null`), `NO_SECTIONS` (MANAGER без разделов). «Подписки N из M»: M = события, где `contextAccess` = да хотя бы в одном контексте; N = события с маршрутом (`RECEIVES` или `BLOCKED`). `listUsers` («Все»): исключить `id = 'system'` и влитых.

### 5.2 `notifications`

**`catalog.ts`:** флаг `staffAlways?: true` у категории `system`; экспорт `EVENT_MODULE_CONTEXTS: Record<string, (string | null)[]>` (Q7); `MODULE_ACCESS_ALIAS = { "rental-inquiry": "rental" }`; комментарий-инвариант Q8.

**`audience-rules.ts`** (leaf, без БД):
```ts
export type StaffSnapshot = { id: string; role: Role; merged: boolean; grants: Set<string>;
  assignments: Set<string>; prefs: Map<string, { enabled: boolean }>; listModules: Set<string> };
export type DeliveryPath = "personal" | "module_list" | "role_avito" | "in_app_superadmin";
export type AccessDecision = { ok: true } | { ok: false; reason: "NOT_STAFF" | "SUPERADMIN_ONLY" | "STRICT_GRANT_REQUIRED" | "NO_SECTION"; label: string };
export type RouteDecision = { receives: boolean; paths: DeliveryPath[]; optedOut: boolean; access: AccessDecision };
export function contextAccess(s: StaffSnapshot, category: ManagedCategory, moduleSlug: string | null, path?: DeliveryPath): AccessDecision;
export function evaluateRoute(s: StaffSnapshot, eventType: string, moduleSlug: string | null): RouteDecision;
export function groupChatDecision(input: { staffAudience?: "personal"; chatEnabled: boolean; listRowCount: number;
  moduleChatId?: string; globalChatId?: string }): { send: boolean; chatId?: string; reason: string };
```

**`audience.ts`:**
```ts
export async function loadStaffSnapshots(where: { userIds?: string[]; eventType?: string; moduleSlug?: string | null },
  db?: PrismaClient | Prisma.TransactionClient): Promise<StaffSnapshot[]>;
// кандидаты: строки NEP по eventType ∪ строки списка moduleSlug ∪ (avito: SUPERADMIN ∪ назначенные) ∪ (telephony: SUPERADMIN)
export async function resolveStaffRouting(input: { eventType: string; moduleSlug: string | null;
  staffAudience?: "personal"; userIds?: string[] }, db?: PrismaClient | Prisma.TransactionClient): Promise<{
  recipients: Array<{ userId: string; paths: DeliveryPath[] }>;
  suppressed: Array<{ userId: string; reason: "OPTED_OUT" }>;
  groupChat: { send: boolean; chatId?: string; botToken?: string; reason: string } }>;
export async function explainStaffNotifications(userIds: string[]): Promise<Map<string, StaffNotificationExplain>>;
```
Переподключение потребителей:
- `service.ts` `notifyAdmin`: `routing = resolveStaffRouting(...)`; `dispatch` каждому `recipients[i]` (один раз); `recordSkips(suppressed)`; `groupChat.send` → как сейчас `telegramAdapter.send` + `logNotification`. Импорты `getExplicitRecipientUserIds`/`getSelfSubscribedUserIds` уходят.
- `src/app/api/avito/webhook/messenger/route.ts`: `resolveLeadRecipients` → `resolveStaffRouting({ eventType: "avito.lead.new", moduleSlug })`.
- `release-notify.ts`: `resolveReleaseAudience` → `resolveStaffRouting({ eventType: RELEASE_EVENT_TYPE, moduleSlug: null })`; `setReleaseSubscription(userId, enabled, meta?: { updatedByUserId?: string; updatedVia?: string })`; `ensureManagerNotifyDefaults` пишет `updatedVia: "system"`.
- `telephony/daily-summary-service.ts`: выбор получателей и перепроверка в транзакции → `resolveStaffRouting({ eventType: TELEPHONY_DAILY_EVENT, moduleSlug: null, userIds? }, tx)`.
- `subscribers.ts` (`getSelfSubscribedUserIds`) и `recipients.ts#getRecipientUserIds` (мёртвый) — удалить; `capabilities.ts#resolveManagedCategories` → категории с `contextAccess.ok` хотя бы в одном контексте (без grandfather).
- `recipients.ts`: `getExplicitRecipientUserIds`, `setRecipientUserIds`, `listEligibleRecipients` переписать на таблицу; допуск: SUPERADMIN, ADMIN, MANAGER с назначением; `setRecipientUserIds(slug, userIds, actorId)` — `deleteMany`+`createMany` в транзакции + `AuditLog notification.recipients.update { moduleSlug, before, after }`; `listEligibleRecipients.isSelected` = реальное членство (в т.ч. SUPERADMIN).

**`subscriptions.ts`:**
```ts
export async function setStaffEventSubscription(input: { targetUserId: string; eventType: string; enabled: boolean;
  actor: { userId: string; via: "admin" | "miniapp" | "matrix" } }): Promise<{ eventType: string; enabled: boolean; before: boolean | null }>;
```
Проверки: тип ∈ `MANAGED_EVENT_TYPES` (`UNKNOWN_EVENT`); цель — сотрудник, невлит (`NOT_IN_TEAM`); включение требует `contextAccess.ok` хотя бы в одном контексте (`NO_ACCESS_TO_CATEGORY`); выключение разрешено всегда. Запись: `upsert` NEP с `updatedByUserId/updatedVia`; `system.release` → `setReleaseSubscription` (+зеркало). `AuditLog notification.preference.update { targetUserId, eventType, before, after, via }` в той же транзакции. `webapp-center.setEventPreference` и `PATCH /api/users/[id]/notify-releases` делегируют сюда (`logAudit` в роуте Центра удаляется — нет двойной записи).

**`explain.ts`** (чистая часть — `delivery-readiness.ts`, загрузка — здесь):
```ts
export type StaffNotificationExplain = { userId: string; role: Role; botStatus: BotStatus;
  channels: Array<{ kind: NotificationChannelKind; label: string; order: number; deliverable: boolean; note?: string }>;
  globalNotes: Array<{ code: "DND" | "QUIET_HOURS"; label: string }>;
  categories: Array<{ key: string; label: string; access: AccessDecision;
    groupChat: Array<{ moduleSlug: string; moduleLabel: string; receives: boolean }>;
    events: ExplainEvent[] }> };
export type ExplainEvent = { eventType: string; label: string; description: string;
  status: "RECEIVES" | "BLOCKED" | "NOT_RECEIVING" | "NO_ACCESS";
  toggle: { enabled: boolean; editable: boolean; source: "explicit" | "default" };
  paths: Array<{ kind: DeliveryPath; label: string; moduleSlug: string | null }>;
  contexts: Array<{ moduleSlug: string | null; receives: boolean; paths: DeliveryPath[] }>;
  deliveryChannels: Array<{ kind: string; label: string }>;
  blockers: Array<{ code: "NO_CHANNEL" | "BOT_NOT_STARTED" | "BOT_BLOCKED" | "CHANNEL_DISABLED" | "DND" | "OPTED_OUT"; label: string }>;
  notes: Array<{ code: "QUIET_HOURS"; label: string }>;
  lastChange: { byName: string | null; via: string; at: string } | null };
```
Каналы — в порядке реальной отправки: `pickChannel` (с `channelKinds` события) + далее цепочка `attemptFallback` (verified, active, registry-available по `priority`). Для `in-app`-категории канал всегда «Лента Mini App». Статус: нет маршрута и нет доступа → `NO_ACCESS`; явное `false` → `NOT_RECEIVING` + блокер `OPTED_OUT` («Отключено: <кто>»); маршрут есть, но ни один канал не доставляем (нет канала; Telegram при `NOT_STARTED`/`BLOCKED` без запасного; канал отключён) или активен DND → `BLOCKED`; иначе `RECEIVES`. **Тихие часы — заметка, а не блокировка** («Тихие часы 22:00–08:00: доставка откладывается»): диспетчер откладывает, а не теряет сообщение — экран обязан говорить правду (осознанное уточнение формулировки AC-C1.5). `toggle.editable` = доступ к категории есть хотя бы в одном контексте или есть явная строка (выключить можно всегда).

**`webapp-center.ts`:** `getNotificationCenter` строится из `explainStaffNotifications([staff.id])`: только категории с доступом; событие → `enabled` = маршрут есть, `caption` («Вы в списке получателей раздела «…»», «По роли: …», «Личная подписка»), `blockers`, `hint` (C3.5: «Запустите бота (нажмите Start), иначе сообщения в Telegram не приходят» с `https://t.me/<TELEGRAM_BOT_USERNAME>`; «Бот заблокирован — разблокируйте его в Telegram»), `emptyState` (C3.4), `transparencyNote` (C3.6), `botStatus`. `ensureTelegramChannel` сохраняется. `CATEGORY_MODULE_SLUGS` удаляется.

**Трекинг `tracking/link-service.ts`:**
```ts
export const LINK_TTL_DAYS = 400;
export function generateLinkCode(): string;                                   // randomBytes(16).base64url
export function normalizeTrackableTarget(raw: unknown, opts: { appOrigin: string; botUsername: string }): string | null;
export async function ensureLinksForDelivery(item: { id: string; fallbackOfId: string | null; userId: string; eventType: string },
  actions: Array<{ label: string; url?: string }>): Promise<Array<{ label: string; url: string }>>; // только разрешённые, url = /r/{code}
export async function resolveLinkForRedirect(code: string): Promise<{ target: string; linkId: string; rootId: string } | null>;
export async function recordLinkClick(linkId: string, rootId: string, at: Date): Promise<void>; // одна транзакция: link first/last/count, root clickedAt=coalesce, clickCount+1
export function isAutomatedRequest(headers: Headers, method: string): boolean;
```
`normalizeTrackableTarget`: строка ≤ 2048; отказ при `\`, `[\u0000-\u001F\u007F]`, пробелах; `/x` (не `//`) → `new URL(x, appOrigin)`; иначе обязательно `https://` (или `http://`, только если `appOrigin` — `http:` в dev); `new URL`; отказ при `username`/`password`; разрешено `origin === new URL(appOrigin).origin` или `hostname === "t.me"` + `pathname.toLowerCase()` начинается с `/${botUsername.toLowerCase()}` и далее конец/`/`; возврат `url.toString()`. Регэксп автоматики: `/(bot|crawl|spider|preview|scan|facebookexternalhit|slack|whatsapp|telegram|discord|skype|vkshare|yandex|bingpreview|googleimageproxy|curl|wget|python-requests|go-http-client|okhttp|headless)/i`, плюс пустой UA и prefetch-заголовки.

**Диспетчер `dispatch/dispatcher.ts`:**
- `dispatch()`: при каждом `skipped` для типа каталога — `recordSkip({ userId, eventType, entityType, entityId, reason })` (`DUPLICATE`, `PREFERENCE_DISABLED`, `DND`, `NO_CHANNEL`), best-effort.
- `deliverOne()`: для типа каталога и внешнего канала — `actions = await ensureLinksForDelivery(item, payload.actions)`; результат канала: `ok` → `externalId` сохраняется; ошибка → `failureCode = result.code ?? "OTHER"`. Для `TELEGRAM`: `ok` → `recordDeliveryProof(item.channel.address)`, `BOT_BLOCKED` → `recordBotBlocked(address)`. Устаревание → `failureCode = "STALE"`; недоступный канал → `CHANNEL_UNAVAILABLE`.
- `dispatch/types.ts`: ошибки `DeliveryResult` получают `code?: DeliveryFailureCode`; `TelegramChannel` и `WebPushChannel` проставляют коды; `WebPushChannel` кладёт `url` (Q4).

**`skips.ts`:** `recordSkip(input)`, `recordSkips(list)` — только `MANAGED_EVENT_TYPES`, ошибки глотаются.

**`feed.ts`:** `markFeedRead` пишет `readVia` (`ids` → `mark`, `upTo` → `bulk`, не перезаписывает уже прочитанные); новая
```ts
export async function openFeedItem(userId: string, input: { id: string; actionIndex?: number }): Promise<{ readAt: string | null; clicked: boolean }>;
```
`on:` — строка пользователя (`where: { id, userId }`), `readAt ??= now`, `readVia ??= 'open'`; при `actionIndex` или наличии первого действия — клик на корне цепочки (`fallbackOfId ?? id`). `ia:` — те же поля через `inAppAccess(userId)`. `bc:` — только watermark. Чужой id ничего не находит.

**`stats.ts`:**
```ts
export async function getNotificationStats(q: { days: 7 | 30 | 90; eventType?: string; category?: string; userId?: string;
  channel?: "TELEGRAM" | "PUSH" | "EMAIL" | "IN_APP" }): Promise<NotificationStats>;
export async function getUserNotificationStats(userId: string, days: 7 | 30 | 90): Promise<UserNotificationStats>;
export async function getMeasurementSince(): Promise<{ clicks: Date | null; skips: Date | null; bot: Date | null }>;
```
**`housekeeping.ts`:** `runNotificationHousekeeping(now)` — раз в сутки (Redis `SET notif:housekeeping:{YYYY-MM-DD} NX EX 90000`) из `processScheduledNotifications`: `DELETE FROM "NotificationLink" WHERE "expiresAt" < now()` и `DELETE FROM "NotificationDeliverySkip" WHERE "createdAt" < now() - interval '180 days'` (батчами по 5000).

**`delivery-labels.ts`:** человеческие подписи `failureCode`/`reason` (AC-D2.3): `BOT_BLOCKED` «Бот заблокирован», `BOT_NOT_STARTED` «Бот не запущен», `USER_DEACTIVATED` «Аккаунт Telegram удалён», `NETWORK`/`CHANNEL_UNAVAILABLE`/`OTHER` «Канал недоступен», `CHANNEL_EXPIRED`/`CHANNEL_AUTH` «Подписка браузера недействительна», `STALE` «Не отправлено вовремя»; пропуски: `NO_CHANNEL` «Нет канала», `DND` «Не беспокоить», `OPTED_OUT`/`PREFERENCE_DISABLED` «Отключено сотрудником», `DUPLICATE` «Дубль».

### 5.3 `telegram-link`

**`bot-contact.ts`:**
```ts
export type BotStatus = { state: "NOT_LINKED" } | { state: "NOT_STARTED"; trackingSince: Date | null }
  | { state: "STARTED"; startedAt: Date | null } | { state: "BLOCKED"; blockedAt: Date };
export function computeBotStatus(telegramId: string | null, c: TelegramBotContact | null, trackingSince: Date | null): BotStatus;
export async function getBotContacts(telegramIds: string[]): Promise<Map<string, TelegramBotContact>>;
export async function getBotTrackingSince(): Promise<Date | null>;      // MIN(createdAt), кэш 10 мин в процессе
export async function recordBotContact(telegramId: string, at?: Date): Promise<void>;   // INSERT … ON CONFLICT: startedAt=COALESCE, lastContactAt=at
export async function recordBotBlocked(telegramId: string, at?: Date): Promise<void>;
export async function recordDeliveryProof(telegramId: string, at?: Date): Promise<void>; // ON CONFLICT DO UPDATE … WHERE lastDeliveryOkAt IS NULL OR < at-1h OR blockedAt > lastDeliveryOkAt
```
Все — raw SQL `INSERT … ON CONFLICT` (одна команда, без гонок); каждая команда явно выставляет `"updatedAt" = now()` (колонка без SQL-дефолта); `telegramId` валидируется `^[0-9]{1,20}$`.

**`service.ts` (переписать OTP и deep-link):**
```ts
export async function requestLink(telegramId: string, input: LinkRequestInput): Promise<LinkRequestResult>;
export async function confirmLink(telegramId: string, code: string): Promise<LinkConfirmResult>;
export async function processDeepLink(input: DeepLinkInput): Promise<DeepLinkResult>;
```
`requestLink`: `type = "phone"` → `PHONE_LINK_UNAVAILABLE`; `!isTransactionalEmailConfigured()` → `OTP_DELIVERY_UNAVAILABLE` (для всех, до поиска аккаунта — без оракула); блок по `telegramId`; лимиты Redis (`tg-link:otp-email:{sha256(email)}` ≤ 3/ч, `tg-link:otp-tg:{tgId}` ≤ 5/ч, сверх → `LINK_BLOCKED` 429 с общим текстом); поиск невлитого по `emailNormalized`/`email`. Ответ **всегда** `{ sent: true, maskedValue: maskEmail(введённый), expiresIn: 600 }` с текстом «Если такой аккаунт есть, мы отправили код на его email». Ветки без отправки кода: аккаунта нет; аккаунт уже владеет этим `telegramId`; SUPERADMIN (вместо кода — информационное письмо, Q9). Иначе: код `crypto.randomInt(100000, 1000000)`, в Redis `{ targetUserId, codeHash: sha256(code + telegramId), emailHash, attempts }` EX 600, письмо `sendTransactionalEmail({ sensitive: true, … })` (шаблон `otp-email.ts`: код, «действует 10 минут», «Если это были не вы — проигнорируйте письмо»). Сбой отправки → удалить OTP, `log.error(EVENT_SOURCES.AUTH, "OTP email send failed", { emailHash })` → `OTP_SEND_FAILED` (узкий оракул только при отказе SMTP на конкретный адрес — принят и задокументирован, ограничен лимитами). **`console.log` с кодом удаляется.**

`confirmLink`: блок; OTP из Redis; `timingSafeEqual` хешей; неверно → `attempts++` (3 → блок 15 мин, как сейчас) и счётчик `tg-link:otp-fail-email:{emailHash}` (5/ч → OTP для адреса не выдаются час); верно → удалить OTP (одноразовость) →
```
target = невлитый пользователь targetUserId (SUPERADMIN → INVALID_CODE: код для него не выдавался)
tgUser = невлитый по telegramId
if !tgUser               → привязать telegramId к target
elif tgUser.id = target  → уже привязан
elif target.telegramId && target.telegramId ≠ telegramId → createMergeRequest(target, tgUser, "telegram_conflict") → TELEGRAM_IN_USE_MERGE_REQUESTED
elif isDisposableTelegramShell(tgUser) → mergeAccounts({ mode: "self_link", primaryId: target.id, secondaryId: tgUser.id, actorId: target.id })
else                     → createMergeRequest(...) → TELEGRAM_IN_USE_MERGE_REQUESTED
после привязки: upsert UserNotificationChannel(TELEGRAM, telegramId, verified, priority 10); recordBotContact(telegramId);
AuditLog telegram.link.otp { targetRole, merged: boolean }   // target не понижается — publishAuthState не нужен
```
Ответ: `{ linked: true, merged, user: { id, name, role, telegramId }, token }` — роут выпускает токен Mini App для `target` с текущим `sv`.

`processDeepLink`: токен → `userId` (web-сессия); конфликт `telegramId` у другого аккаунта → оболочка: `mergeAccounts(self_link, primary = userId)`, иначе `createMergeRequest` + `TELEGRAM_IN_USE_MERGE_REQUESTED`; успех → канал Telegram + `recordBotContact` + `AuditLog telegram.link.deeplink`. Ответ бота с `data.error.message` уже пробрасывается (`bot/handlers/link.ts`).

### 5.4 `clients`

**`merge.ts`:**
```ts
export type MergeMode = "admin" | "clients_only" | "self_link";
export function suggestPrimary(a: AccountBrief, b: AccountBrief): string;   // выше роль; при равенстве — у кого email; иначе раньше создан
export async function previewAccountMerge(input: { primaryId: string; secondaryId: string; actorId: string; mode: MergeMode }): Promise<AccountMergePreview>;
export async function mergeAccounts(input: { primaryId: string; secondaryId: string; actorId: string; mode: MergeMode;
  confirmTelegramConflict?: boolean }): Promise<AccountMergeResult>;
export async function mergeClients(primaryId: string, secondaryId: string, performedById: string): Promise<MergeResult>; // обёртка clients_only
export async function previewMerge(primaryId: string, secondaryId: string): Promise<MergePreview>;                   // обёртка, старый тип
```
`clients/service.ts` реэкспортирует `mergeClients`/`previewMerge` из `merge.ts` (импортёры не меняются). Порядок шагов `mergeAccounts` — Q6; аудит: `admin` → `auth.merge.manual` (metadata `{ mode, primaryId, secondaryId, resultingRole, fkMoved, conflicts, droppedSecondaryRights }`, значения конфликтных контактов вторичного — по AC-E2.8), `self_link` → `auth.merge.self_link` (добавить в `AuthAuditAction`).

**`merge-requests.ts`:**
```ts
export async function createMergeRequest(input: { userAId: string; userBId: string; reason: "telegram_conflict"; telegramId: string }): Promise<"created" | "exists" | "suppressed">;
// sortPair; не создаёт, если пара RESOLVED_KEPT_SEPARATE/RESOLVED_MERGED или один влит (AC-E4.4); PENDING → "exists";
// лимит Redis merge-req:tg:{telegramId} ≤ 3 / 24 ч; AuditLog user.merge_request.created (actor = userA)
export async function listMergeRequests(q: { status?: "PENDING"; userId?: string }): Promise<MergeRequestItem[]>;
export async function dismissMergeRequest(id: string, actorId: string): Promise<void>; // → RESOLVED_KEPT_SEPARATE + resolvedBy + аудит
export async function countPendingMergeRequests(): Promise<number>;
```

### 5.5 SQL статистики (эскиз для `stats.ts`, `prisma.$queryRaw` с параметрами)

```sql
WITH team AS (
  SELECT id FROM "User"
  WHERE role IN ('SUPERADMIN','ADMIN','MANAGER') AND "mergedIntoUserId" IS NULL AND id <> 'system'
    AND ($userId::text IS NULL OR id = $userId)
),
rows AS (
  SELECT o.*, COALESCE(o."fallbackOfId", o.id) AS root_id, c.kind AS channel_kind
  FROM "OutgoingNotification" o JOIN "UserNotificationChannel" c ON c.id = o."channelId"
  WHERE o."userId" IN (SELECT id FROM team) AND o."eventType" = ANY($catalogTypes)
    AND o."createdAt" >= $from - interval '1 day'
),
chains AS (
  SELECT root_id, MIN("userId") AS user_id, MIN("eventType") AS event_type, MIN("createdAt") AS created_at,
    BOOL_OR(status = 'SENT') AS delivered,
    MIN("sentAt") FILTER (WHERE status = 'SENT') AS delivered_at,
    BOOL_OR(status IN ('PENDING','DEFERRED')) AS in_flight,
    (ARRAY_AGG(channel_kind ORDER BY (status = 'SENT') DESC, "createdAt" DESC))[1] AS channel,
    MIN("readAt") FILTER (WHERE "readVia" IS DISTINCT FROM 'bulk') AS read_at,
    (ARRAY_AGG("failureCode" ORDER BY "createdAt" DESC))[1] AS failure_code
  FROM rows GROUP BY root_id HAVING MIN("createdAt") >= $from
),
items AS (
  SELECT ch.user_id, ch.event_type, ch.channel::text AS channel, ch.delivered, ch.delivered_at, ch.in_flight, ch.read_at,
         ch.failure_code, r."clickedAt" AS clicked_at, r."clickCount" AS click_count,
         EXISTS (SELECT 1 FROM "NotificationLink" l WHERE l."outgoingId" = ch.root_id) AS has_link
  FROM chains ch JOIN "OutgoingNotification" r ON r.id = ch.root_id
  UNION ALL
  SELECT i."userId", i."eventType", 'IN_APP', true, i."createdAt", false,
         CASE WHEN i."readVia" IS DISTINCT FROM 'bulk' THEN i."readAt" END, NULL, i."clickedAt", i."clickCount", true
  FROM "InAppNotification" i
  WHERE i."userId" IN (SELECT id FROM team) AND i."eventType" = ANY($catalogTypes) AND i."createdAt" >= $from
),
m AS (
  SELECT *, (delivered AND (channel = 'IN_APP' OR has_link)) AS measurable,
         LEAST(read_at, clicked_at) AS reaction_at
  FROM items
  WHERE /* фильтры eventType / category (eventType = ANY(...)) / channel */ true
)
SELECT GROUPING(event_type) AS g_e, GROUPING(user_id) AS g_u, GROUPING(channel) AS g_c, event_type, user_id, channel,
  COUNT(*) AS sent, COUNT(*) FILTER (WHERE delivered) AS delivered,
  COUNT(*) FILTER (WHERE NOT delivered AND NOT in_flight) AS failed,
  COUNT(*) FILTER (WHERE NOT delivered AND in_flight) AS in_flight,
  COUNT(*) FILTER (WHERE delivered AND read_at IS NOT NULL) AS read,
  COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked_notifications, COALESCE(SUM(click_count), 0) AS clicks_total,
  COUNT(*) FILTER (WHERE measurable) AS measurable, COUNT(*) FILTER (WHERE delivered AND NOT measurable) AS unmeasurable,
  COUNT(*) FILTER (WHERE measurable AND reaction_at IS NOT NULL) AS reactions,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY GREATEST(0, EXTRACT(EPOCH FROM reaction_at - delivered_at)))
    FILTER (WHERE measurable AND reaction_at IS NOT NULL) AS median_reaction_s,
  COUNT(*) FILTER (WHERE measurable AND delivered_at <= now() - interval '24 hours'
                    AND (reaction_at IS NULL OR reaction_at > delivered_at + interval '24 hours')) AS no_reaction_24h,
  COUNT(*) FILTER (WHERE measurable AND delivered_at <= now() - interval '24 hours') AS eligible_24h
FROM m
GROUP BY GROUPING SETS ((), (event_type), (user_id), (channel));
```
Отдельно: пропуски (`NotificationDeliverySkip` по команде и каталогу, `GROUP BY reason`), групповые чаты (`NotificationLog WHERE "userId" IS NULL`, `GROUP BY status`), проблемы (статусы бота команды через `computeBotStatus` + число цепочек с `failure_code IN ('BOT_NOT_STARTED','BOT_BLOCKED')` по пользователям; «нет рабочего канала» и «события без личных получателей» — из `explainStaffNotifications`). Доля реакции = `reactions / measurable` (`null` при 0); доля «без реакции за 24 ч» = `no_reaction_24h / eligible_24h`. `measuredSince.partial = from < clicksSince`. Блок «последние уведомления» сотрудника — отдельный запрос: 20 последних цепочек + `InAppNotification` + пропусков, слитых по времени, **без `payload`**.

---

## 6. API-контракты

Общие правила: ответы через `apiResponse()/apiError()`; Zod до любой операции с БД; роль проверяется до бизнес-логики через `auth()` из `@/lib/auth` (для Mini App — `verifyWebAppToken`/`loadWebAppStaff`); все мутации — `AuditLog`; лимиты по CLAUDE.md: админ-эндпоинты (SUPERADMIN) без лимита, Mini App — `rateLimit(req, "authenticated", userId)` (без валидного токена — `public` по IP), публичный `/r` — `public`. `hasModuleAccess` в новых эндпоинтах **не нужен**: все админ-эндпоинты — SUPERADMIN-only (правило PRD: даже при выданной секции «Пользователи»/«Уведомления»), а Mini App-эндпоинты оперируют только собственными данными пользователя.

### 6.1 Сводная таблица RBAC

| Метод, путь | Доступ | Прочие роли | Без входа | Лимит | Аудит |
|---|---|---|---|---|---|
| `GET /api/users/team` | SUPERADMIN | 403 | 401 | — | — |
| `GET /api/users/[id]/overview` | SUPERADMIN | 403 | 401 | — | — |
| `GET /api/users/[id]/exclude` | SUPERADMIN | 403 | 401 | — | — |
| `POST /api/users/[id]/exclude` | SUPERADMIN | 403 | 401 | — | `user.team.exclude` |
| `PATCH /api/users/[id]` (изм.) | SUPERADMIN | 403 | 401 | — | `user.role.change` / `user.team.exclude` |
| `DELETE /api/users/[id]` (изм.) | SUPERADMIN | 403 | 401 | — | `user.delete` |
| `GET /api/users/[id]/notifications` | SUPERADMIN | 403 | 401 | — | — |
| `PATCH /api/users/[id]/notifications` | SUPERADMIN | 403 | 401 | — | `notification.preference.update` |
| `PATCH /api/users/[id]/notify-releases` (изм.) | SUPERADMIN | 403 | 401 | — | то же |
| `GET /api/users/[id]/notification-stats` | SUPERADMIN | 403 | 401 | — | — |
| `GET /api/users/merge/search` | SUPERADMIN | 403 | 401 | — | — |
| `POST /api/users/merge/preview` | SUPERADMIN | 403 | 401 | — | — |
| `POST /api/users/merge` | SUPERADMIN | 403 | 401 | — | `auth.merge.manual` |
| `GET /api/users/merge-requests` | SUPERADMIN | 403 | 401 | — | — |
| `PATCH /api/users/merge-requests/[id]` | SUPERADMIN | 403 | 401 | — | `user.merge_request.dismissed` |
| `GET/PUT /api/admin/permissions/[userId]` (изм.) | SUPERADMIN | 403 | 401 | — | `permissions.update` |
| `PUT /api/admin/modules/[slug]/recipients` (изм.) | SUPERADMIN | 403 | 401 | — | `notification.recipients.update` |
| `GET /api/admin/notifications/matrix` | SUPERADMIN | 403 | 401 | — | — |
| `GET /api/admin/notifications/stats` | SUPERADMIN | 403 | 401 | — | — |
| `GET/PUT /api/webapp/notification-center` (изм.) | MANAGER/ADMIN/SUPERADMIN — только себя | USER 403 «Доступ отозван» | 401 | authenticated | `notification.preference.update` (via miniapp) |
| `POST /api/webapp/feed/open` | любой с токеном Mini App — только свои строки | — | 401 | authenticated | — (отметка чтения, как существующий `feed/read`) |
| `POST /api/webapp/link/request` (изм.) | любой с токеном Mini App | — | 401 | authenticated + OTP-лимиты | — (код и адрес не логируются) |
| `POST /api/webapp/link/confirm` (изм.) | любой с токеном Mini App | — | 401 | authenticated + блок | `telegram.link.otp`, `auth.merge.self_link`, `user.merge_request.created` |
| `POST /api/webapp/link/deep-link` (изм.) | бот (`x-bot-token`, сравнение `timingSafeEqual`) | 401 | 401 | — | `telegram.link.deeplink` и др. |
| `GET/HEAD /r/[code]` | публично | — | — | public (180/мин IP) | — |

Прокси: `/api/users/*` и `/api/webapp/*` уже проходят `authorized()` (авторизация в роуте); `/api/admin/*` пускает SUPERADMIN/ADMIN/MANAGER до роута — роут обязан отвечать 403 не-SUPERADMIN; `/r/*` вне `matcher` (публичен). Статические сегменты `team`, `merge`, `merge-requests` в `src/app/api/users/` имеют приоритет над `[id]`.

### 6.2 Контракты (Zod — в `validation.ts` соответствующего модуля)

**`GET /api/users/team`** — `teamOverviewQuerySchema = z.object({ role: z.enum(["SUPERADMIN","ADMIN","MANAGER"]).optional(), problems: z.coerce.boolean().optional(), bot: z.enum(["not_started","blocked"]).optional(), noTelegram: z.coerce.boolean().optional(), sort: z.enum(["lastLogin","name"]).optional() })`
```ts
200 { success: true, data: { rows: TeamOverviewRow[]; pendingMergeRequests: number }, meta: { total: number } }
// Реализация (фаза 6): счётчик запросов лежит в data рядом со строками — это данные экрана, а не пагинация.
TeamOverviewRow = { id; name: string|null; image: string|null; role: "SUPERADMIN"|"ADMIN"|"MANAGER";
  email: string|null; emailVerified: boolean; hasTelegram: boolean; botStatus: BotStatusDto;
  sections: Array<{ slug; label; source: "role"|"grant"|"strict_grant" }>; modules: Array<{ slug; name }>;
  subscriptions: { active: number; available: number }; releases: boolean; lastLoginAt: string|null;
  flags: Array<"NO_WORKING_CHANNEL"|"BOT_NOT_STARTED"|"BOT_BLOCKED"|"STALE_LOGIN"|"NO_SECTIONS">; isSeededSuperadmin: boolean }
BotStatusDto = { state: "NOT_LINKED" } | { state: "NOT_STARTED"; trackingSince: string|null }
             | { state: "STARTED"; startedAt: string|null } | { state: "BLOCKED"; blockedAt: string }
```

**`GET /api/users/[id]/overview`** — `userIdParamSchema = z.string().min(1).max(64)`
```ts
200 { data: { kind: "merged"; primaryUserId: string } }
  | { data: { kind: "user";
      user: { id; name; image; role; createdAt; source: string|null; sourceLabel: string; lastLoginAt: string|null; isTeamMember: boolean; isSeededSuperadmin: boolean };
      contacts: { email: string|null; emailVerified: boolean; phone: string|null; telegramLinked: boolean; vkLinked: boolean; authMethods: string[]; botStatus: BotStatusDto };
      access: { sections: Array<{ slug; label; source: "role"|"grant"|"strict_grant" }>; strictSections: Array<{ slug; label; granted: boolean }>;
                modules: Array<{ slug; name }>; recipientLists: Array<{ moduleSlug; label }> };
      actions: { canExclude: boolean; canMerge: true; canResetPassword: boolean; canChangeRole: boolean; canDelete: boolean };
      possibleDuplicates: Array<{ userId; name; role; reason: "phone"|"merge_request"; mergeRequestId?: string }> } }
404 USER_NOT_FOUND
```
Никаких `passwordHash`, `telegramId`, ключей push, токенов.

**`GET /api/users/[id]/exclude`** → `200 { data: ExclusionPreview }` (§5.1) | 404.
**`POST /api/users/[id]/exclude`** — `excludeUserSchema = z.object({ confirmSeeded: z.boolean().optional() }).strict()`
```ts
200 { data: { userId; role: "USER"; removed: { sections: string[]; modules: string[]; recipientLists: string[]; subscriptions: string[] }; sessionsRevoked: true } }
400 CANNOT_EXCLUDE_SELF | 404 USER_NOT_FOUND
409 LAST_SUPERADMIN | NOT_IN_TEAM | ALREADY_EXCLUDED | SEEDED_SUPERADMIN_CONFIRM_REQUIRED | USER_MERGED
422 VALIDATION_ERROR
```

**`PATCH /api/users/[id]`** — `updateUserSchema` + `confirmSeeded: z.boolean().optional()`. Ответ прежний `USER_SELECT` + `exclusion?: ExclusionResult` при переходе в USER. Ошибки — как у exclude + `CANNOT_DEMOTE_SELF`.

**`DELETE /api/users/[id]`** → `200 { data: { deleted: true } }` | `409 USER_HAS_HISTORY { metadata: { blockers: [{ type, label, count }], isTeamMember } }` | 400 `CANNOT_DELETE_SELF` | 404. Код `USER_HAS_SUBSCRIPTIONS` упраздняется (абонементы — один из блокеров `USER_HAS_HISTORY`).

**`GET /api/users/[id]/notifications`** → `200 { data: StaffNotificationExplain }` (§5.2) | 404. Для USER — все категории `NO_ACCESS` с причиной «Не входит в команду».
**`PATCH /api/users/[id]/notifications`** — `userNotificationToggleSchema = z.object({ eventType: z.enum(MANAGED_EVENT_TYPES), enabled: z.boolean(), source: z.enum(["profile", "team", "matrix"]).optional() }).strict()`; `via = source === "matrix" ? "matrix" : "admin"` → `200 { data: ExplainEvent }` (перерасчитанная строка, AC-C1.8) | 404 | 422 `UNKNOWN_EVENT` | `NOT_IN_TEAM` | `NO_ACCESS_TO_CATEGORY`. Тот же эндпоинт обслуживает тумблер на странице, «Релизы» в таблице и клик по ячейке матрицы.

**`GET /api/users/[id]/notification-stats`** — `statsPeriodSchema = z.object({ period: z.coerce.number().refine((v) => [7, 30, 90].includes(v)).default(30) })`
```ts
200 { data: { period: { days; from; to }; measuredSince: { clicks: string|null; partial: boolean };
  totals: Metrics; byEvent: Array<{ eventType; label } & Metrics>; byChannel: Array<{ channel } & Metrics>;
  skips: { total: number; byReason: Array<{ reason; label; count }> };
  recent: Array<{ at: string; eventType; eventLabel; channel: string|null; status: "DELIVERED"|"FAILED"|"IN_FLIGHT"|"SKIPPED";
                  statusLabel: string; reaction: { kind: "read"|"click"; afterSeconds: number } | null }>;   // 20 шт., без текстов
  problems: { botNotStarted: boolean; botBlocked: boolean; failedByBot: number } } }
Metrics = { sent; delivered; failed; inFlight; read; clickedNotifications; clicksTotal; measurable; unmeasurable; reactions;
            reactionRate: number|null; medianReactionSeconds: number|null; noReaction24hShare: number|null }
```

**`GET /api/users/merge/search`** — `z.object({ q: z.string().trim().min(2).max(100), exclude: z.string().max(64).optional() })` → `200 { data: Array<{ id; name; role; email: string|null; phone: string|null; hasTelegram: boolean }> }` (≤ 20, невлитые, без `system`).

**`POST /api/users/merge/preview`** — `mergePairSchema = z.object({ primaryId: z.string().min(1).max(64), secondaryId: z.string().min(1).max(64) }).refine((d) => d.primaryId !== d.secondaryId, "Нельзя объединить аккаунт сам с собой")`
```ts
200 { data: AccountMergePreview }
AccountMergePreview = { primary: AccountSide; secondary: AccountSide; suggestedPrimaryId: string;
  result: { role; name; email; phone; telegramLinked; vkLinked };
  conflicts: Array<{ field: "email"|"phone"|"telegram"|"vk"|"name"; primaryValue: string|null; secondaryValue: string|null; requiresConfirmation: boolean }>;
  access: { sections: string[]; modules: string[]; recipientLists: string[] };
  subscriptions: { kept: string[]; moved: string[]; droppedConflicts: string[] };
  transfer: { bookings; orders; subscriptions; tasks; chatMessages; auditLogs; notifications };
  notTransferred: Array<{ key: "secondaryRole"|"sections"|"modules"; label: string; items: string[] }>;
  blockers: Array<{ code: string; message: string }> }
AccountSide = { id; name; role; email; phone; hasTelegram; hasVk; createdAt; source; isSeededSuperadmin; botStatus: BotStatusDto }
```
Превью ничего не меняет (только чтения).

**`POST /api/users/merge`** — `mergeExecuteSchema = mergePairSchema.and(z.object({ confirmIrreversible: z.literal(true), confirmTelegramConflict: z.boolean().optional() }))` → `200 { data: { primaryId; tombstonedUserId; resultingRole; moved: Record<string, number> } }` | 404 | 409 (`ALREADY_MERGED`, `SECONDARY_IS_ACTOR`, `SECONDARY_SEEDED_SUPERADMIN`, `LAST_SUPERADMIN`, `TELEGRAM_CONFLICT_UNCONFIRMED`, `ACTIVE_SUBSCRIPTION_CONFLICT`) | 422.

**`GET /api/users/merge-requests`** — `z.object({ userId: z.string().max(64).optional() })` → `200 { data: Array<{ id; detectedAt; matchedFields: string[]; reasonLabel; users: [AccountBrief, AccountBrief] }>, meta: { total } }`.
**`PATCH /api/users/merge-requests/[id]`** — `z.object({ action: z.literal("dismiss") }).strict()` → `200 { data: { id; status: "RESOLVED_KEPT_SEPARATE" } }` | 404 | 409 (уже закрыт). «Объединить» — фронт открывает мастер слияния с предзаполненной парой; `mergeAccounts` сам переводит пару в `RESOLVED_MERGED`.

**`GET /api/admin/permissions/[userId]`** →
```ts
200 { data: { userId; userName; userRole; roleSections: Array<{ slug; label }>; grantableSections: Array<{ slug; label }>;
              strictSections: Array<{ slug; label }>; granted: string[]; notes: { superadminStrictAutoGrant: boolean } } }
```
**`PUT /api/admin/permissions/[userId]`** — `permissionsUpdateSchema = z.object({ sections: z.array(z.string().max(50)).max(50) })`. Сервер: молча отбрасывает `roleSections` (совместимость со старым клиентом, AC-A4.2); `telephony`/неизвестные → 422 `SECTION_NOT_GRANTABLE`; USER → 422 `NOT_IN_TEAM`. Замена в транзакции только в пределах `grantable ∪ strict` роли (прочие явные строки не трогаются); если что-то снято → `bumpSessionVersion` + `publishAuthState`. Аудит `permissions.update { targetRole, before, after, added, removed }` (AC-A4.6). Ответ `{ userId, granted }`.

**`PUT /api/admin/modules/[slug]/recipients`** — схема прежняя; добавлены `AuditLog` и допуск SUPERADMIN.

**`GET /api/admin/notifications/matrix`** — `z.object({ category: z.string().max(40).optional(), role: z.enum(["SUPERADMIN","ADMIN","MANAGER"]).optional(), problems: z.coerce.boolean().optional() })`
```ts
200 { data: { events: Array<{ eventType; label; categoryKey; categoryLabel }>;
  rows: Array<{ user: { id; name; role }; cells: Record<string, { status: "RECEIVES"|"BLOCKED"|"NOT_RECEIVING"|"NO_ACCESS"; reason?: string; editable: boolean; enabled: boolean }> }>;
  totals: Record<string, { personalRecipients: number; groupChatOnly: boolean }> } }
```

**`GET /api/admin/notifications/stats`** — `notificationStatsQuerySchema = z.object({ period: (как statsPeriodSchema), eventType: z.enum(MANAGED_EVENT_TYPES).optional(), category: z.string().max(40).optional(), userId: z.string().max(64).optional(), channel: z.enum(["TELEGRAM","PUSH","EMAIL","IN_APP"]).optional() })`
```ts
200 { data: { period; measuredSince: { clicks: string|null; partial: boolean };
  totals: Metrics; byEvent: Array<{ eventType; label; categoryKey } & Metrics>; byUser: Array<{ user: { id; name; role } } & Metrics>;
  byChannel: Array<{ channel } & Metrics>; skips: { total; byReason }; groupChats: { sent: number; failed: number };
  problems: { botNotStarted: { users: number; failedDeliveries: number; userIds: string[] };
              botBlocked: { users: number; failedDeliveries: number; userIds: string[] };
              noWorkingChannel: { users: number; userIds: string[] };
              eventsWithoutPersonalRecipients: { count: number; eventTypes: string[] } } } }
```

**`GET /api/webapp/notification-center`** →
```ts
200 { data: { role; botStatus: BotStatusDto; channel: NotificationCenterChannel; transparencyNote: string;
  emptyState: string | null; hint: { code: "START_BOT"|"UNBLOCK_BOT"; text: string; botUrl?: string } | null;
  categories: Array<{ key; label; description; icon; delivery: "personal"|"group"|"in-app";
    events: Array<{ eventType; label; description; enabled: boolean; caption: string|null; blockers: Array<{ code; label }> }> }>;
  protected: NotificationCenterProtectedNotice[] } }
403 FORBIDDEN «Доступ отозван» (роль USER)
```
**`PUT /api/webapp/notification-center`** — схема прежняя `{ eventType, enabled }` → делегирует `setStaffEventSubscription(via: "miniapp")` → `200 { data: { eventType; enabled } }` | 403 | 422.

**`POST /api/webapp/feed/open`** — `feedOpenSchema = z.object({ id: z.string().regex(/^(on|ia|bc):[A-Za-z0-9:_-]{1,120}$/), actionIndex: z.number().int().min(0).max(2).optional() }).strict()` → `200 { data: { readAt: string|null; clicked: boolean } }` | 401 | 422.

**`POST /api/webapp/link/request`** — `linkRequestSchema = z.object({ type: z.enum(["email","phone"]), value: z.string().trim().min(3).max(255) })`; для `email` сервис дополнительно проверяет `z.string().email()` → `200 { data: { sent: true; maskedValue; expiresIn: 600; message: "Если такой аккаунт есть, мы отправили код на его email." } }` | 422 `PHONE_LINK_UNAVAILABLE` | 429 `LINK_BLOCKED` | 503 `OTP_DELIVERY_UNAVAILABLE` | 502 `OTP_SEND_FAILED`.
**`POST /api/webapp/link/confirm`** — схема прежняя → `200 { data: { linked: true; merged: boolean; user; token } }` | 400 `INVALID_CODE` | 410 `CODE_EXPIRED` | 429 `LINK_BLOCKED` | 409 `TELEGRAM_IN_USE_MERGE_REQUESTED`.
**`POST /api/webapp/link/deep-link`** — прежний контракт + 409 `TELEGRAM_IN_USE_MERGE_REQUESTED`; сравнение `x-bot-token` перевести на `timingSafeEqual`.

**`GET|HEAD /r/[code]`** — `trackingCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/)`; не прошёл → `302` на главную. Ответ всегда `302` (никогда 4xx/5xx), заголовки — Q4. Файл: `src/app/r/[code]/route.ts`, `export const dynamic = "force-dynamic"`, `export const runtime = "nodejs"`.

---

## 7. UI

| Экран | Файлы | Что |
|---|---|---|
| Таб «Команда» (B2) | `src/components/admin/users/team-review-table.tsx` (новый, подключается в `unified-users-page.tsx` вместо `UsersList filterRole="team"`), `merge-requests-panel.tsx`, `bot-status-badge.tsx` | колонки AC-B2.2, флаги, фильтры, сортировка по входу, счётчик «Запросы на объединение: N» с раскрываемой очередью (кнопки «Объединить» → мастер, «Это разные люди»); действия строки «Права», «Пароль», «Исключить из команды», переключатель «Релизы» (тот же `PATCH …/notifications`); имя — ссылка на `/admin/users/[id]` |
| Таб «Все» | `users-list.tsx` | все `alert()`/`confirm()` → диалоги; выбор роли «Пользователь» у сотрудника → `ExcludeDialog`; «Удалить» → при 409 `DeleteBlockedDialog` |
| Страница сотрудника (B1) | `src/app/admin/users/[id]/page.tsx` (server: `auth()`; нет сессии → `/auth/signin?callbackUrl=…`; не SUPERADMIN → `/admin/forbidden`), `src/components/admin/users/profile/{user-profile-page,profile-header,contacts-block,access-block,notifications-block,stats-block,actions-block,danger-zone}.tsx` | `merged` → `router.replace('/admin/users/<primary>?mergedFrom=1')` с баннером; USER → баннер «Не входит в команду» + ссылка на карточку клиента; «Опасные действия»: «Удалить» |
| Диалоги | `exclude-dialog.tsx`, `delete-blocked-dialog.tsx`, `merge-wizard.tsx` (поиск/дубли → «Кого оставить» с `suggestedPrimaryId` → превью → чекбокс «Я понимаю, что действие нельзя отменить в интерфейсе» → отдельный чекбокс конфликта Telegram), `permissions-modal.tsx` (переписать: «Доступны по роли» только чтение, «Можно выдать», «Особый доступ» + пометка для SUPERADMIN) | тексты — из PRD «Тексты интерфейса» |
| Блок «Уведомления» (C1/C2) | `notifications-block.tsx`, `notification-status-cell.tsx` | категории, строка группового чата, события со статусом/путями/каналами/блокировками/«Изменено: …», тумблер (оптимистично, откат при ошибке) |
| Матрица (C4) | `src/app/admin/notifications/matrix/page.tsx`, `src/components/admin/notifications/matrix-table.tsx` | фильтры, итоговая строка, подсветка «Лично не получает никто — только общий чат», клик по ячейке = тумблер (Should) |
| Статистика (D1/D4) | `src/app/admin/notifications/stats/page.tsx`, `src/components/admin/notifications/stats/{stats-page,metric-cards,breakdown-table,problems-block}.tsx` | период 7/30/90, срезы, «i»-подсказки с определениями глоссария, постоянная подпись про Telegram (AC-D1.4), строка «Групповые чаты», пометка «Клики измеряются с …» |
| Навигация уведомлений | `src/app/admin/notifications/page.tsx` | ссылки-вкладки «Маршрутизация / Матрица / Статистика / Рассылка» (Матрица/Статистика — только SUPERADMIN, страницы сами проверяют роль) |
| Получатели раздела | `src/components/admin/modules/notification-recipients-form.tsx` | убрать «Суперадмины (всегда получают)»; SUPERADMIN — обычные чекбоксы (AC-C3.3) |
| Сессии | `src/components/admin/session-watcher.tsx` в `src/app/admin/layout.tsx` | Q1 п.5 |
| Mini App: Центр (C3) | `src/app/webapp/notifications/page.tsx` | эффективный тумблер + подпись пути, блокировки, подсказка «Открыть бота», заметка о прозрачности, пустое состояние, 403 «Доступ отозван» |
| Mini App: лента | `src/app/webapp/page.tsx` | `openItem` → fire-and-forget `POST /api/webapp/feed/open` вместо `feed/read` (кнопки карточки — с `actionIndex`) |
| Mini App: токен | `src/components/webapp/TelegramProvider.tsx` | `apiFetch`: один повтор после 401 через перевыпуск токена |
| Mini App: привязка | `src/app/webapp/link-account/page.tsx` | только email; маскированный адрес и общий текст; ошибки 503/502; 409 → текст AC-E4.1 |

---

## 8. Бот

| Файл | Изменение |
|---|---|
| `bot/middleware/bot-contact.ts` (новый) | `createBotContactMiddleware({ record })` — личный чат, `message`/`callback_query`, `!from.is_bot` → `recordBotContact` (троттлинг 10 мин, `Map` в памяти), всегда `next()`; `handleMyChatMember(ctx)` — `kicked` → `recordBotBlocked` (+сброс троттлинга), `member` → `recordBotContact` |
| `bot/index.ts` | `bot.use(createBotContactMiddleware())` **до** регистрации команд; `bot.on("my_chat_member", handleMyChatMember)`; экспорт `BOT_ALLOWED_UPDATES = ["message", "edited_message", "callback_query", "my_chat_member"] as const`; `bot.start({ allowed_updates: BOT_ALLOWED_UPDATES, onStart })` |
| `bot/handlers/link.ts` | без изменения контракта; успешный текст учитывает `merged` |
| `bot/handlers/auth-deeplink.ts` | без изменений (`ADMIN_NO_BOT_LOGIN` остаётся); вход через бота обновляет `lastLoginAt` через `events.signIn` NextAuth при завершении входа на сайте |
| `bot/handlers/team-settings.ts` | без изменений (роль из БД на каждое действие) |

Сидеры: `scripts/seeds/core.ts` берёт id из `getSeededSuperadminTelegramId()` (поведение не меняется); `scripts/seeds/nedelovoy-grants.ts` — фильтр `mergedIntoUserId: null` (влитые бывшие суперадмины не получают гранты обратно). Исключённый (USER) сидерами не трогается (AC-A1.11) — тест.

---

## 9. Безопасность / RBAC (сводка)

- **RBAC:** все админ-эндпоинты — явная проверка `session.user.role === "SUPERADMIN"` до Zod и бизнес-логики, в т.ч. при выданной секции «Пользователи»/«Уведомления». Mini App — только собственные данные (`userId` берётся из токена, никогда из тела).
- **Отзыв доступа:** Q1; демотированный не сохраняет уровень до перелогина (AC-A2.2).
- **Секреты в ответах:** нет `passwordHash`, `telegramId` (в т.ч. сидированного — только флаг `isSeededSuperadmin`), push-ключей, кодов OTP, хешей; `externalId` в ответах статистики не отдаётся. Тексты уведомлений в «последних уведомлениях» не возвращаются (AC-D2.2).
- **OTP:** код только в письме; в Redis — `sha256(code + telegramId)`; сравнение `timingSafeEqual`; `console.log` удалён; `sendTransactionalEmail({ sensitive: true })` не логирует тело даже без SMTP; ответ не раскрывает существование аккаунта (кроме задокументированного случая отказа SMTP на конкретный адрес); лимиты: 3/ч на адрес, 5/ч на Telegram, 3 неверных → блок 15 мин, 5 неверных на адрес/ч → адрес заморожен на час.
- **Open redirect / SSRF:** эндпоинты не принимают URL от пользователя; цель трекинга формирует сервер при отправке, белый список при записи и при редиректе; `?url=`, `//host`, `\\host`, `javascript:`, `data:`, кодирование и двойное кодирование не участвуют (параметры не читаются, а сохранённая цель нормализована `new URL` + сравнение origin/hostname). Сервер по ссылке не делает исходящих запросов (SSRF неприменим).
- **Слияние:** только SUPERADMIN (кроме `self_link` «оболочки», доказанной `initData` + OTP или web-сессией + ботом); превью обязательно; блокировки строк `FOR UPDATE`; запрет вливать себя и сидированного; нельзя остаться без суперадмина.
- **Наблюдение за сотрудниками:** заметка в Центре (AC-C3.6); тексты в статистике не показываются; рекомендация PO — предупредить команду до релиза (в release notes).
- **AuditLog:** `user.team.exclude`, `user.role.change`, `user.delete`, `permissions.update`, `notification.preference.update`, `notification.recipients.update`, `auth.merge.manual`, `auth.merge.self_link`, `telegram.link.otp`, `telegram.link.deeplink`, `user.merge_request.created`, `user.merge_request.dismissed`. Email/телефон в записи исключения не дублируются (AC-A1.9).
- **Логи:** ошибки OTP — `SystemEvent` ERROR (`source: auth`) с `emailHash`, без адреса и кода; отсутствие SMTP-конфигурации — WARNING не чаще раза в минуту.

---

## 10. План тестов (Vitest, `vi.mock("@/lib/db")`, без реальной БД)

| Файл | Проверяет |
|---|---|
| `prisma/__tests__/team-access-notifications-schema.test.ts` | новые модели/поля в `schema.prisma`; FK `ModuleNotificationRecipient` → `User`/`Module` CASCADE; `NotificationLink` → `OutgoingNotification` CASCADE; в миграции есть перенос JSON (`jsonb_array_elements_text`) и бэкфилл `TelegramBotContact … ON CONFLICT DO NOTHING`; нет `DROP`/`DELETE FROM` |
| `src/modules/users/__tests__/deletion-blockers.test.ts` | счётчики и подписи, скрытие нулевых; **покрытие реестром всех RESTRICT/NO ACTION FK на `"User"`** (парсинг миграций, последняя дефиниция по имени constraint) |
| `src/lib/__tests__/session-revocation.test.ts` | Redis hit/miss, fallback в БД, `EX 60`, `publishAuthState` после bump, ошибки Redis глотаются |
| `src/lib/__tests__/auth-jwt.test.ts` | токен без `sv` при версии 0 не меняется; несовпадение → роль/разделы перечитаны; влит/удалён → `null`; вход ставит `sv`; ошибка БД → токен сохраняется; ADMIN получает role-owned разделы |
| `src/lib/__tests__/webapp-auth.test.ts` (расш.) | `sv` расхождение / влит → `null`; `unavailable` → пропуск |
| `src/lib/__tests__/permissions.test.ts` (расш.) | `computeAdminSections` для всех ролей; `getGrantableSections` |
| `src/modules/users/__tests__/exclusion.test.ts` | **контрольный набор QA A1** (MANAGER: 3 раздела, 2 назначения, 2 списка, один без назначения, 4 подписки с релизами, бронь, 3 задачи, 5 записей журнала): все `deleteMany` с точными `where`, NEP только по каталогу, зеркало релизов, bump + publish, ровно одна запись журнала со списками; гарды self / last SA (не влитые, не `system`) / not in team / already excluded (без журнала) / seeded без и с подтверждением; параллельный вызов (после `FOR UPDATE` роль уже USER) |
| `src/modules/users/__tests__/role-change.test.ts` | → USER делегирует исключению; понижения bump-ают; повышение до MANAGER: `dashboard` + релизы (AC-A2.4); аудит было→стало |
| `src/modules/users/__tests__/team.test.ts` | флаги, «N из M», 4 статуса бота, исключение влитых и `system`, сортировка; `isDisposableTelegramShell` |
| `src/app/api/users/**/__tests__/*.test.ts` | для каждого нового роута: 401, 403 (ADMIN с секцией `users`, MANAGER, USER), happy path, ≥ 1 ошибка; `DELETE` 409 с `metadata.blockers` |
| `src/app/api/admin/permissions/[userId]/__tests__/route.test.ts` | SUPERADMIN: сохранение строгого без 400, role-разделы молча отбрасываются; ADMIN: выдача/снятие; `telephony` → 422; аудит before/after; снятие → bump |
| `src/modules/notifications/__tests__/audience-rules.test.ts` | таблица `contextAccess`/`evaluateRoute` по всем путям и причинам отказа; явное `false` перекрывает список/роль/in-app; явное `true` добавляет |
| `src/modules/notifications/__tests__/audience-parity.test.ts` | **AC-C1.6:** генератор сотрудников во всех комбинациях (роль × гранты × назначение × в списке × предпочтение {нет, вкл, выкл} × строгий грант × влит); для каждого события каталога × контекста: `resolveStaffRouting().recipients` == `{u : explain RECEIVES ∨ BLOCKED}`; `notifyAdmin`, Авито, релиз и сводка звонков диспатчат ровно этот набор (dispatch замокан); 0 расхождений |
| `src/modules/notifications/__tests__/service.test.ts` (обн.) | групповой режим при пустой таблице; строки в таблице → чат не получает; `personal`; пропуски `OPTED_OUT` записаны |
| `src/modules/notifications/__tests__/explain.test.ts` | статусы, порядок каналов, блокировки (нет канала, бот не запущен/заблокирован, канал отключён, DND), тихие часы — заметка, «Изменено: …», строка группового чата |
| `src/modules/notifications/__tests__/subscriptions.test.ts` | каталог, доступ, «выкл» без доступа разрешено, зеркало релизов, `updatedBy/Via`, аудит в транзакции |
| `src/modules/notifications/__tests__/webapp-center.test.ts` (обн.) | участник списка видит «Вкл» с подписью; Авито выкл/вкл; нет grandfather; пустое состояние; подсказки бота; 403 «Доступ отозван» |
| `src/modules/notifications/__tests__/catalog.test.ts` (расш.) | каждый тип каталога имеет контекст; инвариант Q8 |
| `src/modules/notifications/tracking/__tests__/link-service.test.ts` | длина/алфавит кода; белый список: `/x` ок, свой origin ок, `t.me/<bot>` ок, `t.me/other` нет, `//evil`, `\\evil`, `/\evil`, `javascript:`, `data:`, `https://user@host`, чужой хост, `%2F%2Fevil`, двойное кодирование, пробелы/управляющие — нет; идемпотентность по `(outgoingId, actionIndex)`; неразрешённые действия выпадают |
| `src/app/r/[code]/__tests__/route.test.ts` | валидный → 302 на сохранённую цель, `no-store`; клик пишется (first + count), повтор — только count; HEAD/бот-UA/пустой UA/prefetch — без записи; неизвестный/битый/просроченный → 302 главная; `?url=https://evil` игнорируется; ошибка записи → 302 на цель; лимит → 302 главная; сохранённая цель, не прошедшая белый список, → главная |
| `src/modules/notifications/dispatch/__tests__/dispatcher-tracking.test.ts` | обёртка действий только для каталога и внешних каналов; fallback использует ссылки корня; `failureCode`, `externalId`; TG ок → `recordDeliveryProof`, `BOT_BLOCKED` → `recordBotBlocked`; пропуски только для каталога |
| `src/modules/notifications/dispatch/channels/__tests__/telegram-failure-codes.test.ts`, `web-push/__tests__/channel.test.ts` (расш.) | маппинг ошибок; push-тело содержит `url` |
| `src/modules/notifications/__tests__/feed.test.ts` (расш.) | `openFeedItem`: прочтение + клик = одна реакция, корень fallback-цепочки, чужой id не задевает, `ia:` с перепроверкой роли; `upTo` → `readVia = bulk` |
| `src/modules/notifications/__tests__/stats.test.ts` | **контрольный набор QA D** → Отправлено 13, Доставлено 11, Ошибки 2, Прочитано 2, уникальных с кликом 5, кликов 6, реакций 6, измеримых 9, доля 67 %, «измерить нельзя» 2, проблемы 1 + 1; сумма срезов = итог; `partial`; только команда; групповые чаты отдельно (SQL — через мок `$queryRaw` с фикстурой результата + юнит чистой постобработки) |
| `src/modules/notifications/__tests__/housekeeping.test.ts`, `recipients.test.ts` (обн.) | раз в сутки; сроки; таблица вместо JSON; SUPERADMIN допускается; аудит |
| `src/modules/telegram-link/__tests__/bot-contact.test.ts` | первая дата не перезаписывается; блок → контакт снимает; 4 состояния; доказательство доставки; бэкфилл «дата неизвестна» |
| `src/modules/telegram-link/__tests__/service.test.ts` (переписать) | письмо уходит, код не в `console.*` (spy); общий ответ для «нет аккаунта», SUPERADMIN (инфо-письмо, без кода), «уже привязан»; SMTP не настроен → 503 всем; отказ отправки → 502; лимиты; 3 неверных → блок; код одноразовый; confirm: оболочка → `mergeAccounts(self_link)`; история → запрос + 409; у цели другой TG → запрос; телефон → 422; deep-link: оболочка/запрос/канал |
| `src/modules/clients/__tests__/merge.test.ts` | **контрольный набор QA E2**; правила (а)–(д); конфликт TG требует подтверждения; актор-вторичный, сидированный, последний SA, уже влит, два ACTIVE-абонемента — отказ; списки получателей переписаны без дублей; права вторичного удалены; порядок «освободить → заполнить»; outgoing переадресованы; бот-контакт `least`; аудит; publish; режим `clients_only` — прежние тесты зелёные |
| `src/modules/clients/__tests__/merge-requests.test.ts` | одна открытая на пару (обе стороны пары), подавление после «разные люди»/слияния, лимит на Telegram |
| `bot/__tests__/bot-contact-middleware.test.ts`, `bot/__tests__/index-wiring.test.ts` (расш.) | только личный чат; группы игнорируются; троттлинг; `my_chat_member`; `BOT_ALLOWED_UPDATES` содержит все используемые типы и `my_chat_member` |
| `scripts/seeds/__tests__/nedelovoy-grants.test.ts`, `core.test.ts` (расш.) | влитый SA не получает гранты; исключённый (USER) не восстанавливается повторным прогоном |
| `src/app/webapp/notifications/__tests__/*.test.tsx` (расш.) | подпись «Вы в списке получателей раздела», подсказка «Открыть бота» |

`npm test` зелёный после каждой фазы.

---

## 11. Порядок реализации (фазы = коммиты одного PR)

1. **Схема и фундамент:** миграция + `schema.prisma`; `seeded-superadmin.ts`; `computeAdminSections`/`getGrantableSections`; тест схемы. (`feat(db): …`)
2. **Отзыв сессий:** `session-revocation.ts`, `auth.ts`/`auth.config.ts` (`sv`, `lastLoginAt`), `webapp-auth.ts`, `SessionWatcher`, `TelegramProvider` (повтор после 401), `/api/webapp/auth` (`sv`, `lastLoginAt`, `allows_write_to_pm`). Тесты.
3. **Блок A:** `exclusion.ts`, `deletion-blockers.ts`, роуты `exclude`/`PATCH`/`DELETE`, права (`GET/PUT permissions` + модалка), диалоги в `users-list.tsx`, фильтр сидера. Тесты.
4. **Сбор данных (раньше UI — данные не восстановить):** `TelegramBotContact` + бот-middleware; коды ошибок/`externalId`; трекинг-ссылки + `/r`; Web Push `url`; пропуски; `feed/open` + `readVia`; уборка. Тесты.
5. **Единый резолвер:** `audience-rules.ts`, `audience.ts`, таблица получателей в `recipients.ts`, переподключение `notifyAdmin`/Авито/релизов/звонков, `subscriptions.ts`, `explain.ts`, Центр Mini App, форма получателей. Тест паритета.
6. **Блоки B/C UI:** `team.ts` + `/api/users/team`, `/overview`, `/notifications`; таб «Команда», страница сотрудника, матрица.
7. **Блок D:** `stats.ts`, `/api/admin/notifications/stats`, `/api/users/[id]/notification-stats`, страница статистики, блок на странице сотрудника, проблемы.
8. **Блок E2–E4:** `merge.ts`, `merge-requests.ts`, роуты слияния и очереди, мастер слияния; OTP и deep-link в `telegram-link`; экран привязки Mini App.
9. **Документация:** CLAUDE.md (§13), статус ADR, release notes (изменения маршрутизации Q7, заметка о статистике для команды, видимые категории в Центре, ADMIN-разделы по роли).

---

## 12. Риски и откат

| Риск | Митигирование |
|---|---|
| Ошибка в `jwt`-callback разлогинит всех | `sv` отсутствует → 0 = дефолт; fail-open при сбое инфраструктуры; отдельный тест; откат — revert коммита фазы 2 (колонка остаётся неиспользуемой) |
| Auth.js в установленной версии не удаляет сессию при `return null` из `jwt` | тест на установленной версии; fallback: вернуть токен с `role: "USER"`, `adminSections: []`, `revoked: true`, `session` callback отдаёт USER — доступ к админке закрыт так же |
| Изменение маршрутизации уведомлений на проде | тест паритета; группа и списки 1:1; явный список изменений поведения в release notes |
| Blue-green: старый контейнер читает JSON-получателей | ключ JSON не удаляется в этом релизе |
| `allowed_updates` бота сузит входящие апдейты | константа + тест «все используемые типы» |
| SMTP на проде не настроен | OTP честно отвечает 503; мониторинг WARNING |
| Ложные «Бот не запущен» у тех, кто писал боту до учёта | бэкфилл по доставкам/входам; подпись «Обращений не зафиксировано с <дата>» |
| Трекинг-редирект недоступен при падении БД | БД — общая точка отказа приложения; редирект на главную, а не 5xx |
| Слияние необратимо в UI | обязательное превью, чекбоксы, `FOR UPDATE`, tombstone вместо удаления, аудит со счётчиками |
| ADMIN получает страницы gazebos/ps-park/inventory по роли | совпадает с действующей API-политикой и комментарием `ADMIN_EDITABLE_MODULES`; в release notes |
| Объём PR | фазы-коммиты с зелёным `npm test` на каждой; ревью по фазам |

Откат данных — §3.3.

---

## 13. Изменения CLAUDE.md (в этом же PR, Scope guard п.4)

Обновить строки таблицы модулей (новых строк нет):

- **`users`:** «Admin user management; «Исключить из команды» (offboarding без удаления, атомарно, с отзывом сессий `User.sessionVersion`), страница сотрудника `/admin/users/[id]`, таб «Команда» как экран ревью, объяснение блокеров удаления — ADR `2026-10-25-team-access-notifications`».
- **`notifications`:** дописать «единый резолвер получателей `audience.ts`/`audience-rules.ts` (рассылка и экраны считают одной функцией), списки получателей разделов в `ModuleNotificationRecipient`, трекинг-ссылки `/r/[code]` (`NotificationLink`), пропуски доставки (`NotificationDeliverySkip`), статистика доставки и реакций `/admin/notifications/stats`, матрица `/admin/notifications/matrix` — ADR `2026-10-25-team-access-notifications`».
- **`telegram-link`:** «Telegram account linking for notification delivery; functionally part of `notifications`; признак «бот запущен/заблокирован» (`TelegramBotContact`), OTP-самопривязка по email (код письмом) со слиянием пустого Telegram-аккаунта, запрос на объединение при конфликте».
- **`clients`:** «Tenant CRM; движок объединения аккаунтов `merge.ts` (клиенты и сотрудники: превью, роль и права основного, перенос истории, очередь запросов на объединение на `MergeCandidate`)».

В раздел **RBAC** добавить абзац: «Отзыв доступа: исключение из команды, понижение роли, снятие раздела и вливание аккаунта инкрементируют `User.sessionVersion`; полный `jwt`-callback сверяет `sv` через Redis-кэш (TTL 60 с), админка опрашивает `/api/auth/session` (`SessionWatcher`), Mini App сверяет `sv` в своём токене. `src/proxy.ts` остаётся без БД. `getUserAdminSections` — единственный источник разделов (ADMIN: гранты ∪ gazebos/ps-park/inventory)».

---

## 14. Отвергнутые альтернативы

1. **Database-сессии Auth.js** — несовместимы с Credentials-провайдерами (они требуют JWT), запрос в БД на каждый запрос, переписывание входа.
2. **Короткий `maxAge` JWT (минуты)** — в Auth.js нет refresh для Credentials: постоянные перелогины.
3. **Проверка отзыва в `src/proxy.ts` через Redis** — ломает конвенцию edge-совместимого `authConfig`; watcher + проверка в полном callback укладываются в 60 с.
4. **Сравнение `iat` токена с отметкой отзыва** — Auth.js перекодирует токен (и обновляет `iat`) в прокси и session-эндпоинте; claim `sv` устойчив.
5. **Получатели в JSON + `jsonb_set`** — не защищает от RMW шести других писателей; нет FK/каскада; дрейф при слиянии.
6. **Журнал реакций «строка на событие»** — избыточно для AC (первый клик + счётчик).
7. **Самоподписанные трекинг-токены с целью внутри** — класс open-redirect, нельзя отозвать, длинные URL.
8. **Трекинг-редирект для ленты Mini App** — уводит WebView на сайт; авторизованный `feed/open` точнее (знаем пользователя) и не мешает навигации.
9. **Признак бота колонками на `User`** — теряет обращения до привязки.
10. **Разведение ключей подписки staff/client** — клиентский путь не использует `NotificationEventPreference`; достаточно инварианта и теста.
11. **OTP к SUPERADMIN с аудитом** — противоречит политике «админ-аккаунты не дополняются через публичные потоки»; deep-link из сессии решает задачу.
12. **Автослияние любого TG-аккаунта по OTP** — поглощение чужой истории по одному письму; только «оболочка».
13. **Смена механики сидера суперадмина** — вне скоупа PRD; предупреждение + запрет вливать сидированного достаточно.
14. **Предагрегированная дневная статистика** — при ~55 тыс. цепочек за 90 дней агрегация на лету укладывается в бюджет; предагрегаты добавили бы рассинхрон.
15. **Несколько PR по волнам** — Scope guard п.3; фазы-коммиты одного PR.
16. **Удалить легаси `/api/admin/notifications/routing-map/stats`** — вне скоупа; эндпоинт не используется UI, остаётся как есть (кандидат в зонтик мелочей).
