# ADR: Напоминания администратору о незакрытых сессиях с Web Push fallback

## Статус
Предложено

## Контекст

PRD: `docs/requirements/2026-05-10-overdue-session-reminders-prd.md`.

Проблема: PS Park / беседки имеют сессии в статусах `CHECKED_IN`/`CONFIRMED`, у которых `endTime` прошёл, но менеджер забыл закрыть. F2 (PR #242) добавил красную карточку — это пассивный сигнал, видимый только когда менеджер смотрит на экран. Нужен активный канал доставки.

Существующая инфраструктура (НЕ переписываем):

- `INotificationChannel` (`src/modules/notifications/dispatch/types.ts`) — single-target send(address, payload).
- `ChannelRegistry` + `bootstrapChannels()` (`channels/index.ts`) — реестр каналов.
- `NotificationDispatcher.dispatch` — выбирает ОДИН канал по `priority` через `pickChannel`, кладёт `OutgoingNotification` (PENDING/DEFERRED), `processOutgoing` — рассылает.
- `UserNotificationChannel(userId, kind, address, priority, isActive)` — per-user адрес, `@@unique([userId, kind, address])`.
- `OutgoingNotification.dedupKey` + `isDuplicate(...)` (5-минутное окно).
- `PushChannel` stub — `kind = "PUSH"`, `isAvailable() = false`. Заменяется реальной реализацией, регистрация остаётся.
- Cron-паттерн: `GET /api/cron/<name>` + `Authorization: Bearer ${CRON_SECRET}` + `safeCompare` через `timingSafeEqual` — образец `src/app/api/cron/rental-payment-reminders/route.ts`.

---

## Открытые вопросы PO — решения

### Вопрос 1. Multi-device fan-out для Web Push

**Варианты:**

- **A. Расширить `INotificationChannel.send`** так, чтобы канал внутри себя делал fan-out по подпискам. Минусы: меняет контракт интерфейса, нарушает симметрию single-target каналов (Telegram/Email/SMS — у пользователя один адрес/чат); диспетчер уже выбрал ОДИН `UserNotificationChannel.id` и записал его в `OutgoingNotification.channelId` — fan-out внутри send требует пересмотра модели "одна доставка = одна запись".
- **B. Каждая `WebPushSubscription` = отдельная запись в `UserNotificationChannel` с `kind = "PUSH"`, `address = JSON.stringify(PushSubscription)`, у каждой свой `priority`.** Dispatcher через `pickChannel` уже выбирает по `priority asc` — он возьмёт ТОЛЬКО ОДНУ запись (=одно устройство). Это не fan-out, это "best device".
- **C. Отдельный `MultiDevicePushDispatcher`** поверх `dispatch()`. После того как `dispatch` решил, что канал = PUSH, отдельный слой ищет все активные подписки юзера и шлёт каждой. Требует разветвления записи `OutgoingNotification` (одна на устройство) или отдельной модели `OutgoingPushFanout`.

**Выбрано: B + adapter-level fan-out внутри `WebPushChannel.send` для запасной симметрии.**

Конкретно:

1. **Каноническая модель — B.** На каждую подписку создаётся одна запись `UserNotificationChannel(kind=PUSH)` с `address = endpoint` (URL endpoint, человекочитаемый и уникальный per-device), `label = userAgent`, `priority` назначается в порядке регистрации (101, 102, 103…). Поле `address` уникально per-user (constraint `@@unique([userId, kind, address])` уже существует).
2. **Dispatcher без изменений.** `pickChannel` берёт первую активную PUSH-запись по приоритету. Если она fail (410 Gone), Dispatcher по существующей retry-логике пометит её `FAILED`/деактивирует и при следующем dispatch события возьмёт следующую по приоритету.
3. **`WebPushSubscription` всё-таки нужна как 1:1 sidecar к `UserNotificationChannel(kind=PUSH)`.** В `UserNotificationChannel.address` хранить весь JSON неудобно (длинный, плохо индексируется); endpoint — естественный ключ. `WebPushSubscription.endpoint` UNIQUE и FK через `userNotificationChannelId` (1:1, optional). Криптоключи `p256dh`/`auth` живут в `WebPushSubscription` — не в JSON-строке.

**Почему не C (fan-out):** PRD US-4 явно говорит "Dispatcher при dispatch выбирает один канал по приоритету; отправка на все устройства пользователя — вне скоупа" (раздел Edge Cases). Решение B полностью укладывается в текущий контракт `INotificationChannel`, не требует расширений и оставляет дверь для C в будущем без миграции данных (достаточно добавить новый dispatcher слой).

**Telegram остаётся single-target** — на пользователя одна запись `UserNotificationChannel(kind=TELEGRAM)`. Никаких изменений.

### Вопрос 2. VAPID key rotation

**Решение: однократная генерация на старте, формальная процедура ротации задокументирована, но не автоматизируется.**

- Ключи генерируются один раз: `npx web-push generate-vapid-keys` → значения кладутся в env `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT="mailto:admin@delovoy-park.ru"` и в публичный `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- Ротация инвалидирует все существующие подписки, требует переподписки всеми пользователями. Для платформы с ~5–15 менеджерами это приемлемая разовая операция, но не оправдывает инфраструктуру для regular rotation.
- **Триггеры внеплановой ротации:** компрометация private key, миграция инфраструктуры. Процедура (в `docs/devops/vapid-rotation.md`):
  1. Сгенерировать новую пару.
  2. Ввести новые значения в env, рестарт.
  3. Менеджеры заходят в админку — UI обнаруживает несовпадение `applicationServerKey` с серверным, показывает баннер "Переподпишитесь на уведомления", старая `WebPushSubscription` помечается `isActive=false` после первого 401/403 от push-сервиса (обрабатывается тем же путём, что и 410 Gone).
- **Хранение private key:** только env-переменная, никогда не в БД и не в git. В коде доступ только через серверные роуты (`src/modules/notifications/dispatch/channels/web-push/vapid.ts`).

### Вопрос 3. Пороги 5/15/30 минут

**Решение: константы в коде модуля сканера + override через `Module.config` JSONB по slug ('ps-park', 'gazebos').**

- Константы по умолчанию в `src/modules/booking/overdue-reminders.ts`:
  ```ts
  export const DEFAULT_OVERDUE_THRESHOLDS = {
    firstReminderMin: 5,
    managerEscalationMin: 15,
    superadminEscalationMin: 30,
  } as const;
  ```
- При скане сначала читается `Module.config.overdueThresholds` для конкретного `moduleSlug`, при отсутствии — берутся дефолты. Чтение и валидация:
  ```ts
  const cfg = z.object({
    firstReminderMin: z.number().int().min(1).max(360),
    managerEscalationMin: z.number().int().min(1).max(720),
    superadminEscalationMin: z.number().int().min(1).max(1440),
  }).partial().safeParse(module.config?.overdueThresholds ?? {});
  ```
- **Никакой новой таблицы** — `Module.config` уже JSONB, мы туда уже кладём конфиги (см. CLAUDE.md «Config as Code»). Для MVP UI редактирования не делаем (PRD прямо говорит «вне скоупа»), но возможность переопределить значениями вручную через DB-shell или будущий `/admin/modules/[slug]/config` уже есть.
- **Соблюдение scope guard:** новых таблиц нет, новых полей в `Booking` нет, всё через существующий `Module.config`.

---

## Варианты архитектуры (ключевые развилки)

### 1. Где хранить криптоключи браузерной подписки

- **A. В `UserNotificationChannel.address` как JSON-строка** `{endpoint, keys:{p256dh, auth}}`. Плюсы: ноль новых таблиц, диспетчеру удобно — `channel.address` сразу принимаем в `web-push.sendNotification`. Минусы: address становится 300+ символов, хуже читается в логах, нельзя искать по endpoint, нельзя хранить userAgent / lastSeenAt; uniqueness `(userId, kind, address)` ломается при незначительном различии порядка ключей в JSON.
- **B. Sidecar-таблица `WebPushSubscription` 1:1 с `UserNotificationChannel(kind=PUSH)`.** `address` = endpoint (стабильный URL), а ключи в отдельной таблице. Плюсы: нормализованная схема, индексируемый endpoint, метаданные (userAgent, lastSuccessAt, lastFailureAt), чистый аудит. Минусы: одна доп. модель.

**Выбрано: B.** Эта схема уже фактически в PRD «Модель данных». Sidecar чище и не блокирует будущий fan-out (C).

### 2. SW: next-pwa vs ручной `public/sw.js`

- **A. `next-pwa`** (или `@ducanh2912/next-pwa`) — генерация Workbox-based SW при сборке, конфиг в `next.config.js`. Плюсы: офлайн-кеш бесплатно, manifest подхват. Минусы: новая зависимость, пакет ставит много транзитивных deps, конфликтует с Next 15 App Router (известный баг — workbox-window не учитывает RSC), маскирует логику push-handler внутри сгенерированного бандла, усложняет debug.
- **B. Ручной `public/sw.js` ~50 строк.** Только то, что нужно — listener `push` и `notificationclick`. Регистрация через `navigator.serviceWorker.register('/sw.js')` из клиентского компонента `WebPushOptIn`. Минусы: нет офлайн-кеша из коробки (он не нужен — это админка, не B2C-витрина), нет автоматической инвалидации SW при деплое (решается полем `sw.js?v=<BUILD_ID>` или `updateViaCache: 'none'`).

**Выбрано: B.** Принцип «не переусложняй». Web Push нужен исключительно для уведомлений; офлайн-функциональность админки не нужна и потенциально опасна (старые UI могут отправить запросы к новому API).

### 3. Где живёт cron-сканер просроченных сессий

- **A. Отдельные файлы для каждого модуля:** `src/modules/ps-park/overdue-reminders.ts` + `src/modules/gazebos/overdue-reminders.ts`. Плюсы: domain isolation. Минусы: 95% кода идентично — оба читают `Booking` с одинаковым фильтром по статусам и `endTime`, отличие только в `moduleSlug`-фильтре. Дублирование без выигрыша.
- **B. Единый `src/modules/booking/overdue-reminders.ts`.** В `src/modules/booking/` уже живёт shared booking core (CLAUDE.md, «Реальный список модулей»). Сканер обходит модули списком `['ps-park', 'gazebos']`, для каждого читает `Module.config.overdueThresholds`, формирует payload с правильными именами ресурсов (Стол / Беседка). Плюсы: одна точка изменения порогов, дедупликация через одну таблицу, проще тесты.

**Выбрано: B.** Shared booking core уже существует. Этот сканер — расширение `booking` модуля, не новый домен.

### 4. Эскалация по таймерам 15/30 — cron vs метаданные на Booking

- **A. Поле `Booking.metadata.lastReminderAt`.** При каждом scan читаем metadata, сравниваем дельты. Минусы: запись metadata мутирует исходную сущность, риск потери при concurrent updates другими частями системы (cafe/ps-park пишут в metadata своё), невозможна симметричная история.
- **B. Анализ существующих `OutgoingNotification` по `(userId, eventType, entityId)`.** Сканер за каждый прогон делает один запрос: «по `entityId = booking.id` есть ли запись с `eventType = "session.overdue.reminder"` и `sentAt != null`? с `eventType = "session.overdue.escalation.manager"`?». Если да и прошло >= 15 мин (или 30) — следующий шаг. Плюсы: source of truth — журнал доставки, не metadata; естественная idempotency через существующий `dedupKey`; ничего не мутирует в `Booking`.

**Выбрано: B.** `OutgoingNotification.entityType="Booking"`/`entityId=booking.id` — уже зарезервировано в схеме. Использование разных `eventType` на каждом шаге автоматически обходит 5-минутный dedup-window для разных событий, как явно указано в PRD AC-2.3.

### 5. Авторизация cron — `CRON_SECRET` vs тот же `processScheduledNotifications`

- **A. Отдельный `GET /api/cron/overdue-session-reminders` + `CRON_SECRET`** — консистентно с `rental-payment-reminders`, `process-recurring`, `no-show`. crontab/GitHub Actions раз в 5 минут.
- **B. Встроить в существующий `processScheduledNotifications` (`/api/cron/notifications`).** Минусы: процессинг outgoing-очереди и сканер-просроченных сессий — разные ответственности; ошибка в одном валит другой.

**Выбрано: A.** Один cron = один endpoint = один `CRON_SECRET`. Нагрузка минимальна.

---

## Решение

1. **Web Push** реализуется как полноценный канал `WebPushChannel implements INotificationChannel` (kind=PUSH) — заменяет существующий stub. Регистрация в `bootstrapChannels()`.
2. **Multi-device** через множественные записи `UserNotificationChannel(kind=PUSH, address=endpoint)` per-device + sidecar `WebPushSubscription` для криптоключей и метаданных.
3. **PWA**: ручной `public/sw.js` + `public/manifest.json`, регистрация SW из клиентского компонента в админке.
4. **Cron-сканер** живёт в `src/modules/booking/overdue-reminders.ts`, exposed через `GET /api/cron/overdue-session-reminders` (CRON_SECRET, каждые 5 минут).
5. **Эскалация** — анализ `OutgoingNotification` по `entityId = booking.id` + разные `eventType` на каждом шаге (5/15/30 мин).
6. **VAPID** — однократная генерация в env, ротация ручная по протоколу.
7. **Пороги** — константы в коде + override через `Module.config.overdueThresholds`.

---

## Схема данных (Prisma)

### Новая модель: `WebPushSubscription`

```prisma
model WebPushSubscription {
  id                       String   @id @default(cuid())
  userId                   String
  user                     User     @relation("WPSUser", fields: [userId], references: [id], onDelete: Cascade)

  // 1:1 с UserNotificationChannel(kind=PUSH). Обе записи создаются в одной транзакции.
  // Optional: позволяет при ручной чистке снести только UNC и потом — сабскрипшен.
  userNotificationChannelId String? @unique
  userNotificationChannel   UserNotificationChannel? @relation("UNCPush", fields: [userNotificationChannelId], references: [id], onDelete: SetNull)

  endpoint                 String   @unique  // стабильный URL push-сервиса (FCM/APNs/Mozilla)
  p256dh                   String              // base64url, ECDH public key подписки
  auth                     String              // base64url, auth secret
  userAgent                String?  @db.Text   // диагностика — Chrome 120 / Safari iOS 17
  isActive                 Boolean  @default(true)
  lastSuccessAt            DateTime?           // успешная отправка
  lastFailureAt            DateTime?           // последняя ошибка (для UI «не получали 7 дней — переподпишитесь»)
  lastFailureReason        String?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  @@index([userId, isActive])
}
```

В `User` добавляется reverse relation:

```prisma
webPushSubscriptions WebPushSubscription[] @relation("WPSUser")
```

В `UserNotificationChannel` добавляется reverse relation:

```prisma
webPushSubscription WebPushSubscription? @relation("UNCPush")
```

### Изменения в существующих моделях

- `Booking` — изменений нет.
- `OutgoingNotification` — изменений нет. Используем существующие `eventType`, `entityType="Booking"`, `entityId`, `dedupKey`.
- `Module.config` — задокументированный (но не схематизированный — JSONB) ключ `overdueThresholds: { firstReminderMin, managerEscalationMin, superadminEscalationMin }`. Обновляется через будущий `/admin/modules/[slug]/config` (не в этом PR) или вручную DBA.

### Новые `eventType` (только строки, enum'а нет)

| eventType | Кому | Триггер |
|---|---|---|
| `session.overdue.reminder` | MANAGER модуля | endTime + 5 мин и не закрыт |
| `session.overdue.escalation.manager` | MANAGER модуля | endTime + 15 мин (после `reminder`) |
| `session.overdue.escalation.superadmin` | SUPERADMIN | endTime + 30 мин |

Регистрируются как known events в `src/modules/notifications/events.ts` (если такая регистрация существует — добавить).

### Миграция

`prisma/migrations/20260510000001_web_push_subscription/migration.sql`:
- CREATE TABLE `WebPushSubscription` со всеми полями + индексами.
- `npx prisma migrate dev --name web_push_subscription`.

Backward compatibility: ничего не удаляется, только add. Откат — drop table.

---

## API-контракты

Все ответы через `apiResponse()` / `apiError()`. Все входы через Zod (`src/modules/notifications/dispatch/channels/web-push/validation.ts`).

### `GET /api/notifications/web-push/vapid-public-key`

- **RBAC:** аутентифицированный пользователь любой роли (нужен и менеджеру, и суперадмину; USER не получит — у него нет UI подписки, но эндпоинт сам по себе не утечка — public key и так публичный по дизайну VAPID).
- **Rate limit:** 60 / мин / IP (стандарт публичных).
- **Response 200:**
  ```json
  { "success": true, "data": { "publicKey": "B...base64url..." } }
  ```
- **Response 503:** если `VAPID_PUBLIC_KEY` не сконфигурирован — `{ success:false, error:{ code:"WEB_PUSH_DISABLED", message:"Web Push not configured" } }`.

### `POST /api/notifications/web-push/subscribe`

- **RBAC:** SUPERADMIN или MANAGER (любой модуль). USER → 403.
- **Rate limit:** 10 / мин / user (защита от accidental loop в SW регистрации).
- **Request body (Zod):**
  ```ts
  webPushSubscribeSchema = z.object({
    endpoint: z.string().url().max(2000),
    keys: z.object({
      p256dh: z.string().min(1).max(200),
      auth: z.string().min(1).max(100),
    }),
    userAgent: z.string().max(500).optional(),
  });
  ```
- **Логика:**
  1. Внутри транзакции: `prisma.userNotificationChannel.upsert` по `(userId, kind="PUSH", address=endpoint)` — `priority` = `(max существующих PUSH-priorities у юзера) + 1` или 100 если первый.
  2. `prisma.webPushSubscription.upsert` по `endpoint` — обновляет p256dh/auth/userAgent, ставит `isActive=true`, привязывает `userNotificationChannelId`.
  3. `AuditLog`: `action: "web_push.subscribed"`, `entity: "WebPushSubscription"`, `entityId: subscription.id`.
- **Validation errors:** 422 `INVALID_PAYLOAD` с массивом field errors. Любые URL-ы, которые не на белом списке доменов push-сервисов (`fcm.googleapis.com`, `*.push.apple.com`, `updates.push.services.mozilla.com`, `wns2-*.notify.windows.com`) — отклоняются с 422 `INVALID_ENDPOINT` (защита от SSRF: нельзя подсунуть произвольный URL, через который потом сервер будет POST'ить).
- **Response 200:** `{ subscriptionId, channelId }`.

### `DELETE /api/notifications/web-push/subscribe`

- **RBAC:** SUPERADMIN или MANAGER (только своя подписка). USER → 403.
- **Rate limit:** 10 / мин / user (см. POST — общий tier `web-push-subscribe`).
- **Request body (Zod):** `{ endpoint: z.string().url() }` + SSRF allowlist (`isAllowedPushEndpoint`) — для согласованности с POST и защиты от логических атак.
- **Логика:** транзакционно: `WebPushSubscription` `isActive=false`, `UserNotificationChannel` `isActive=false`. Физически не удаляем — для аудита.
- **AuditLog:** `action: "web_push.unsubscribed"` — пишется только если подписка реально деактивирована.
- **Response — всегда 200 (idempotent):**
  - happy path → `{ ok: true, alreadyInactive: false }`
  - подписка не найдена / уже неактивна / принадлежит другому юзеру → `{ ok: true, alreadyInactive: true }` (не утечка факта существования чужой подписки; идиоматично для DELETE — повторный вызов = тот же ответ).

### `POST /api/cron/overdue-session-reminders`

- **Auth:** `Authorization: Bearer ${CRON_SECRET}` или `?token=`. `safeCompare` через `timingSafeEqual` (как в `rental-payment-reminders/route.ts`).
- **Метод:** GET для консистентности с другими cron-ами проекта (`/api/cron/rental-payment-reminders` тоже GET); если хотим строгости — POST. Фиксируем: **GET**, чтобы не плодить несоответствий.
- **Частота:** каждые 5 минут (crontab VPS: `*/5 * * * *`).
- **Логика (см. ниже «Эскалация»).**
- **Response 200:** `{ scanned: number, reminders: number, escalationsManager: number, escalationsSuperadmin: number, skippedNoChannel: number }`.

### `GET /api/notifications/web-push/health` (опционально)

- **RBAC:** SUPERADMIN.
- **Response:** `{ vapidConfigured: boolean, activeSubscriptions: number, last24hSent: number, last24hFailed: number, expiredAutoDeactivated: number }`.

### Существующие endpoints, которые НЕ меняются

- `/api/cron/notifications` (processOutgoing) — продолжает рассылку очереди.
- `/api/notifications/channels/*` — управление приоритетами `UserNotificationChannel` (PRD US-7) — уже существует или будет добавлен в отдельной итерации, не блокирует MVP.

---

## Структура модулей

### `src/modules/notifications/dispatch/channels/web-push/`

```
web-push/
├── index.ts          // export class WebPushChannel implements INotificationChannel
├── vapid.ts          // setVapidDetails(), readVapidConfigFromEnv(), isConfigured()
├── service.ts        // subscribe(userId, dto), unsubscribe(userId, endpoint), deactivateExpired(endpoint)
├── validation.ts     // Zod схемы webPushSubscribeSchema, webPushUnsubscribeSchema + SSRF allowlist встроен рядом с Zod-схемами (ALLOWED_PUSH_HOSTS — refine() прямо в schema)
└── __tests__/
    ├── channel.test.ts
    ├── service.test.ts
    └── validation.test.ts
```

`bootstrapChannels()` (в `channels/index.ts`) меняет одну строку — `import { PushChannel } from './stubs'` заменяется на `import { WebPushChannel } from './web-push'`, регистрация: `ChannelRegistry.register(new WebPushChannel())`.

### `src/modules/booking/overdue-reminders.ts`

Сервис сканера. Экспортирует:

```ts
export const DEFAULT_OVERDUE_THRESHOLDS = { firstReminderMin: 5, managerEscalationMin: 15, superadminEscalationMin: 30 };

export async function scanAndDispatchOverdue(): Promise<{
  scanned: number;
  reminders: number;
  escalationsManager: number;
  escalationsSuperadmin: number;
  skippedNoChannel: number;
}>;
```

Внутри: для каждого `moduleSlug ∈ ['ps-park', 'gazebos']`:
1. Прочитать `Module.config.overdueThresholds`.
2. Прочитать просроченные `Booking` (`status IN [CHECKED_IN, CONFIRMED]`, `endTime < now - firstReminderMin`).
3. Для каждой брони определить, в какой «слот» эскалации она попадает: `[5..15)` → reminder; `[15..30)` → manager-escalation; `[>=30]` → superadmin-escalation.
4. Для reminder/manager-escalation: список адресатов = `User.role=MANAGER` через `ModuleAssignment.moduleId = Module(slug).id`.
5. Для superadmin-escalation: `User.role=SUPERADMIN, isActive`.
6. На каждого адресата вызов `NotificationDispatcher.dispatch({ userId, eventType, entityType:"Booking", entityId: booking.id, payload })`. Дедупликация автоматически — существующий `OutgoingNotification.dedupKey` (5-минутное окно), а разные `eventType` дают разную key для разных шагов.
7. Для superadmin-эскалации параллельно — `prisma.systemEvent.create({ level:"WARNING", source:"scheduler", ... })`.

### Cron route

`src/app/api/cron/overdue-session-reminders/route.ts` — повторяет паттерн `rental-payment-reminders`: `safeCompare` + вызов `scanAndDispatchOverdue()`.

### Клиентский компонент

`src/components/admin/notifications/WebPushOptIn.tsx`:
- Hooks: `useEffect` проверяет `'PushManager' in window && Notification.permission`.
- Если `unsupported` (нет PushManager) — компонент рендерит `null` (PRD AC-5.6, AC-6.5).
- Кнопка «Включить уведомления» / «Уведомления включены» / «Заблокировано в браузере».
- При клике: запрос permission → `navigator.serviceWorker.register('/sw.js')` → `registration.pushManager.subscribe({ applicationServerKey, userVisibleOnly:true })` → `POST /api/notifications/web-push/subscribe`.
- Используется в админ-навигации: `src/app/(admin)/admin/layout.tsx` рендерит `<WebPushOptIn />` для MANAGER/SUPERADMIN.

### PWA ассеты

- `public/manifest.json`:
  ```json
  {
    "name": "Деловой — администратор",
    "short_name": "Деловой Admin",
    "start_url": "/admin",
    "scope": "/admin",
    "display": "standalone",
    "background_color": "#0b0d12",
    "theme_color": "#0b0d12",
    "icons": [
      { "src": "/icons/admin-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
      { "src": "/icons/admin-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
    ]
  }
  ```
  `scope: /admin` — критично, чтобы PWA не «съедала» B2C-фронт; для пользователей сайта PWA не активируется.
- `public/sw.js`:
  ```js
  self.addEventListener('push', (event) => {
    const data = event.data?.json() ?? {};
    const { title = 'Деловой', body = '', actions = [], tag } = data;
    event.waitUntil(self.registration.showNotification(title, {
      body, tag, data, requireInteraction: false,
      icon: '/icons/admin-192.png', badge: '/icons/badge.png',
    }));
  });
  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.actions?.[0]?.url ?? '/admin';
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const c of clients) if (c.url.includes(url)) return c.focus();
        return self.clients.openWindow(url);
      })
    );
  });
  ```
- `<link rel="manifest" href="/manifest.json">` и `<meta name="apple-mobile-web-app-capable" content="yes">` добавляются в `src/app/(admin)/admin/layout.tsx` (НЕ в публичный layout!).

---

## VAPID и env-переменные

| Переменная | Значение | Где читается |
|---|---|---|
| `VAPID_PUBLIC_KEY` | base64url public key | `web-push/vapid.ts` (server) |
| `VAPID_PRIVATE_KEY` | base64url private key | `web-push/vapid.ts` (server only, **никогда не отдаётся клиенту**) |
| `VAPID_SUBJECT` | `mailto:admin@delovoy-park.ru` | `web-push/vapid.ts` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | копия `VAPID_PUBLIC_KEY` | `WebPushOptIn.tsx` (client) |
| `WEB_PUSH_ENABLED` | `true`/`false` (default false на dev) | feature-flag в `WebPushChannel.isAvailable()` и в роуте `/api/notifications/web-push/vapid-public-key` |

**Процедура генерации:**
```bash
npx web-push generate-vapid-keys --json
# скопировать в .env.production (через secrets manager VPS), не коммитить
```

`.env.example` дополняется тремя плейсхолдерами без значений.

`WebPushChannel.isAvailable()`:
```ts
isAvailable(): boolean {
  return process.env.WEB_PUSH_ENABLED === 'true'
      && !!process.env.VAPID_PUBLIC_KEY
      && !!process.env.VAPID_PRIVATE_KEY
      && !!process.env.VAPID_SUBJECT;
}
```

---

## Эскалация — детальный механизм

В одном прогоне сканера для каждой просроченной брони:

```
overdueMin = (now - booking.endTime) / 60_000

if (overdueMin >= superadminEscalationMin) {
  // 30+ мин
  for each superadmin:
    dispatch({ eventType: "session.overdue.escalation.superadmin", entityId: booking.id, payload, userId })
  // dedup window 5 мин по (userId, eventType, entityId, payload-hash) — повтор подавлен.
  // Цикл прогон @ 35, 40 мин — повторно не пошлёт суперадмину.
} else if (overdueMin >= managerEscalationMin) {
  // 15..30 мин
  for each manager:
    dispatch({ eventType: "session.overdue.escalation.manager", ... })
} else if (overdueMin >= firstReminderMin) {
  // 5..15 мин
  for each manager:
    dispatch({ eventType: "session.overdue.reminder", ... })
}
```

Дедупликация:
- Существующий `dedupKey = sha256(userId|eventType|entityId|payload-canonical)`.
- 5-минутное окно (`isDuplicate` смотрит `OutgoingNotification.createdAt > now-5m`).
- Между шагами `eventType` меняется → разные dedupKey → новый шаг проходит даже если старый ещё в окне.
- Между прогонами одного шага (5+5=10 мин) — `eventType` тот же → dedup срабатывает → повтор не уходит.

**Граничный случай:** scanner пропустил один прогон (downtime) и брони уже 11 мин просрочки. Слот всё ещё `[5..15)` → шлём `reminder`. Когда брони 16 мин — слот `[15..30)` → шлём `escalation.manager`. Корректно.

---

## Обработка expired/invalid Web Push subscriptions

`WebPushChannel.send`:
```ts
async send(endpoint, payload): Promise<DeliveryResult> {
  const sub = await prisma.webPushSubscription.findUnique({ where: { endpoint } });
  if (!sub || !sub.isActive) return { ok:false, reason:"subscription not found", retryable:false };
  try {
    await webPush.sendNotification(
      { endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60, urgency: 'high' }
    );
    await prisma.webPushSubscription.update({ where:{endpoint}, data:{ lastSuccessAt: new Date() }});
    return { ok: true };
  } catch (err: any) {
    const status = err.statusCode;
    if (status === 404 || status === 410) {
      // Gone — endpoint мёртв, отписать на нашей стороне
      await prisma.$transaction([
        prisma.webPushSubscription.update({ where:{endpoint}, data:{ isActive:false, lastFailureAt:new Date(), lastFailureReason:`HTTP ${status}` }}),
        prisma.userNotificationChannel.updateMany({ where:{ kind:"PUSH", address: endpoint }, data:{ isActive:false }}),
      ]);
      return { ok:false, reason:`expired (${status})`, retryable:false };
    }
    if (status === 401 || status === 403) {
      // VAPID mismatch — авто-деактивируем все subs (вероятно ротация без переподписки)
      await prisma.webPushSubscription.update({ where:{endpoint}, data:{ isActive:false, lastFailureAt:new Date(), lastFailureReason:`VAPID ${status}` }});
      await prisma.userNotificationChannel.updateMany({ where:{kind:"PUSH", address: endpoint}, data:{ isActive:false }});
      return { ok:false, reason:`auth ${status}`, retryable:false };
    }
    if (status === 429 || (status >= 500 && status < 600)) {
      return { ok:false, reason:`HTTP ${status}`, retryable:true };
    }
    return { ok:false, reason:err.message ?? 'unknown', retryable:false };
  }
}
```

Retry policy для retryable:
- `processOutgoing` уже делает retry с +5 мин паузой, max 3 попытки (`maxAttempts`).
- После исчерпания — `OutgoingNotification.status="FAILED"`. Подписка не деактивируется автоматически (мог быть временный network blip).
- Cron-задача (вне скоупа этой фичи): раз в неделю помечать `isActive=false` подписки с `lastSuccessAt < now - 30d AND lastFailureAt > lastSuccessAt`.

---

## RBAC — матрица

| Endpoint | SUPERADMIN | MANAGER | USER |
|---|---|---|---|
| `GET /api/notifications/web-push/vapid-public-key` | R | R | R (но UI скрыт) |
| `POST /api/notifications/web-push/subscribe` | W (своя) | W (своя) | 403 |
| `DELETE /api/notifications/web-push/subscribe` | W (своя) | W (своя) | 403 |
| `GET /api/cron/overdue-session-reminders` | — | — | — (CRON_SECRET) |
| `GET /api/notifications/web-push/health` | R | — | — |

Проверки:
- `auth()` → если null → 401 (для всех кроме cron).
- Для USER на subscribe/unsubscribe: `if (session.user.role === 'USER') return apiError('FORBIDDEN', ..., 403)`.
- `hasModuleAccess` НЕ нужен — Web Push подписка относится к личной учётке, не к модулю.

---

## Безопасность

1. **VAPID private key — env only.** Не пишется в БД, не уходит в API response, не логируется.
2. **Endpoint allowlist** в `subscribe` — защита от SSRF: только `*.fcm.googleapis.com`, `*.push.apple.com`, `*.notify.windows.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`. Любой другой host → 422.
3. **CRON_SECRET** — `timingSafeEqual` (через `safeCompare`).
4. **`AuditLog`** на `subscribe`/`unsubscribe`. Не логировать `p256dh`/`auth` (в metadata только `endpoint` и `userAgent`).
5. **Payload не содержит PII клиента-арендатора.** В уведомление кладём id брони, имя ресурса, время — без email/телефона клиента.
6. **Rate limit** на `subscribe` (10/min) — защита от лупа в кривом SW.
7. **`UserNotificationChannel.address` хранит endpoint, не криптоключи.** Endpoint сам по себе не позволяет отправить пуш без `p256dh`/`auth` (которые в sidecar и в env-private-key).
8. **CSP / SW scope:** `sw.js` лежит в `/public/`, scope контролируется `Service-Worker-Allowed` хедером в Next.js (по умолчанию `/`); для админки делаем явный `scope: '/admin'` при register.

---

## Зависимости

Новый npm-пакет: **`web-push`** (https://github.com/web-push-libs/web-push). Лицензия **MPL-2.0** — допущена через явное исключение в `agents/SECURITY.md` (раздел «Supply Chain → Исключения по лицензиям»), решение владельца от 2026-05-10. MPL-2.0 — file-level copyleft, библиотеку используем без модификаций, copyleft-обязательства не активируются. Поддерживается, ~5M downloads/week, нет уязвимостей CVE на 2026-05-10. Версия точная (без `^`).

Альтернатива — реализовать VAPID JWT и Push API encryption руками. Не оправдано (4–5 RFC, ECDH, AES-128-GCM, HKDF).

`@types/web-push` — devDependency.

Никаких других новых зависимостей.

---

## Тесты (Vitest)

Моки:
```ts
vi.mock('web-push', () => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
}));
vi.mock('@/lib/db');
```

Обязательные:

1. **`web-push/__tests__/channel.test.ts`**
   - `isAvailable()` → false без env, true с полным набором.
   - `send` happy path → ok:true, обновляет `lastSuccessAt`.
   - `send` 410 → ok:false, retryable:false, деактивирует Subscription и UNC.
   - `send` 500 → retryable:true.
   - `send` 401/403 → деактивирует subscription (VAPID mismatch).

2. **`web-push/__tests__/service.test.ts`**
   - `subscribe` создаёт UNC + WebPushSubscription, `priority` = max+1.
   - Повторный `subscribe` с тем же endpoint — обновляет p256dh/auth, не плодит дубль (за счёт `@@unique` и `@unique`).
   - `unsubscribe` помечает оба isActive=false.
   - SSRF: endpoint с `evil.com` → ValidationError.

3. **`web-push/__tests__/validation.test.ts`**
   - Zod: пустой p256dh → fail; URL с длиной >2000 → fail.

4. **`booking/__tests__/overdue-reminders.test.ts`**
   - Брони `endTime < now - 5m` → reminder для каждого MANAGER.
   - Брони `endTime < now - 15m` → escalation.manager (и НЕ reminder, т.к. слот другой).
   - Брони `endTime < now - 30m` → escalation.superadmin для каждого SUPERADMIN + SystemEvent WARNING.
   - Брони `status=COMPLETED` пропускаются.
   - Менеджер чужого модуля не получает (фильтр через `ModuleAssignment`).
   - Override порогов через `Module.config.overdueThresholds` уважается.
   - При отсутствии активных каналов у менеджера → `dispatch` возвращает `skipped`, scanner инкрементирует `skippedNoChannel` и пишет SystemEvent WARNING.

5. **API route handlers** (happy + 1 error path):
   - `POST /api/notifications/web-push/subscribe` — happy, USER → 403, invalid endpoint → 422.
   - `DELETE` — happy, чужая/несуществующая подписка → 200 `{ alreadyInactive: true }`, USER → 403.
   - `GET /api/cron/overdue-session-reminders` — happy, wrong token → 401.
   - `GET /api/notifications/web-push/vapid-public-key` — happy, без env → 503.

---

## Поэтапная реализация — 4 PR'а

**PR 1 — Schema + WebPushChannel skeleton (без cron, без UI)**
- Prisma миграция `WebPushSubscription`, генерация client.
- `src/modules/notifications/dispatch/channels/web-push/{index,vapid,validation,endpoint-allowlist}.ts`.
- Регистрация в `bootstrapChannels()` (заменяет stub).
- env-переменные в `.env.example` + DEPLOYMENT.md (раздел «VAPID generation»).
- Тесты: channel.test.ts, validation.test.ts.
- **Граница:** канал зарегистрирован, но `WEB_PUSH_ENABLED=false` по умолчанию → `isAvailable()=false` → Dispatcher просто не использует. Безопасный no-op деплой.

**PR 2 — API + service**
- `src/modules/notifications/dispatch/channels/web-push/service.ts` (subscribe, unsubscribe).
- `GET /api/notifications/web-push/vapid-public-key`.
- `POST/DELETE /api/notifications/web-push/subscribe`.
- Тесты на service + route handlers.
- **Граница:** API работает, но без UI и без cron — никто Web Push ещё не получает.

**PR 3 — PWA + UI компонент подписки**
- `public/manifest.json`, `public/sw.js`, иконки.
- `src/components/admin/notifications/WebPushOptIn.tsx`.
- Подключение в `src/app/(admin)/admin/layout.tsx` (manifest link + компонент).
- Manual QA: подписаться из Chrome, проверить что в БД появилась запись + UNC создан с priority.
- **Граница:** менеджеры могут подписаться, но cron ещё не отправляет напоминания. На этом этапе — только тестовая отправка через прямой вызов `dispatch()` из dev-консоли.

**PR 4 — Cron-сканер просроченных сессий**
- `src/modules/booking/overdue-reminders.ts` со `scanAndDispatchOverdue`.
- `GET /api/cron/overdue-session-reminders` (CRON_SECRET).
- Регистрация в crontab VPS: `*/5 * * * * curl -H "Authorization: Bearer $CRON_SECRET" https://delovoy-park.ru/api/cron/overdue-session-reminders` — добавляется в `DEPLOYMENT.md`.
- Тесты на overdue-reminders.test.ts.
- Для production включается `WEB_PUSH_ENABLED=true` после успешной первой подписки SUPERADMIN'а из админки и проверки доставки.
- **Граница:** end-to-end работает. Метрики (PRD): отслеживаем avg_closure_delay_min через 4 недели.

(Опциональный PR 5 — `/api/notifications/web-push/health` + UI-индикатор для SUPERADMIN, NOT BLOCKING.)

---

## Последствия

- **Schema:** +1 модель `WebPushSubscription`, +1 relation в `User`, +1 relation в `UserNotificationChannel`.
- **Миграция:** одна, чисто additive.
- **Existing channels:** не трогаем. `PushChannel` stub удаляется из `channels/stubs.ts` (или остаётся как мёртвый код для backward compat — лучше удалить, чтобы не путать).
- **DevOps:** новые env (3 серверных + 1 публичный + 1 feature flag), новый cron entry, иконки в `public/icons/`.
- **Зависимости:** `web-push` (MIT, well-maintained).
- **Backward compatibility:** при `WEB_PUSH_ENABLED=false` всё ведёт себя как раньше (PushChannel был stub `isAvailable=false`). Никаких ломающих изменений.
- **Security:** SSRF allowlist для endpoint, AuditLog, CRON_SECRET timingSafeEqual, VAPID private key только в env.
- **Влияние на другие модули:** `ps-park`, `gazebos` — НЕ модифицируются. Сканер живёт в `booking` и читает `Booking` напрямую.

---

## Связанные документы

- PRD: `docs/requirements/2026-05-10-overdue-session-reminders-prd.md`
- Архитектура notifications dispatch: существующий код в `src/modules/notifications/dispatch/`
- Образец cron pattern: `docs/architecture/2026-04-21-rental-email-notifications-adr.md`, `src/app/api/cron/rental-payment-reminders/route.ts`
- F2 (красная карточка PS Park): PR #242
