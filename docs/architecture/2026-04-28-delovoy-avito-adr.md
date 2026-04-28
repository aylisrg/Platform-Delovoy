# ADR: Деловой Авито — интеграция Avito Professionals API

**Дата:** 2026-04-28
**Статус:** Принято
**Автор:** System Architect
**PRD:** `docs/product/2026-04-28-delovoy-avito-prd.md`

---

## Контекст

Бизнес-парк "Деловой" использует Авито как канал привлечения клиентов для Барбекю Парка и PS Park. Текущая интеграция (`src/lib/avito.ts`) — тонкий OAuth2 клиент с одной функцией `getAvitoItemStats()` для одного объявления, ID которого зашит в `AVITO_ITEM_ID`. Это блокирует:

1. Подключение нескольких объявлений (PS Park не подключён вообще).
2. Маршрутизацию лидов из Messenger в Tasks-канбан Phase 5.4.
3. Мониторинг отзывов и пропущенных звонков.

PO передал PRD с 4 этапами и 12 user stories (US-1.1 … US-4.1). Ключевые ограничения PRD:
- **Не создаём** `src/modules/avito/` — это интеграция, а не бизнес-домен.
- Один Avito-аккаунт, много объявлений → реестр `AvitoItem` с привязкой к `moduleSlug`.
- Avito-канал встраивается в `NotificationDispatcher` Phase 5.4 как `INotificationChannel`.
- Лиды и звонки — Task-и с дедупом и idempotency.

---

## Закрытие open questions из PRD

Перед проектированием решения изучены публичные источники: каталог `developers.avito.ru/api-catalog`, репозитории-обёртки на GitHub (`avito-tech/api-clients`, OSS-имплементации Messenger webhook) и обсуждения в Avito Pro support.

### Q1: Может ли Messenger API отправлять первое сообщение в "холодный" чат?

**Ответ: Нет.** `POST /messenger/v1/accounts/{user_id}/chats/{chat_id}/messages` требует существующий `chat_id`, который Avito создаёт **только когда покупатель сам инициирует диалог** (нажимает "Написать продавцу" на карточке объявления). API не предоставляет endpoint вида `/chats/start_with_user`, который позволил бы продавцу инициировать переписку с произвольным `user_id`. Это сделано для антиспама и не зависит от тарифа.

**Следствие для US-2.3 (автоответ за 60 секунд):**
Переформулируем: автоответ срабатывает **в реакции на первое входящее сообщение** клиента (а не превентивно). Это полностью соответствует AC-1, AC-3, AC-4 из US-2.3 — там и так написано «после создания задачи из входящего сообщения». Никакого "холодного outreach" в PRD не предусмотрено. Сценарий:

1. Клиент пишет в Авито Messenger → создаётся `chat_id` со стороны Avito.
2. Avito шлёт нам webhook (или мы получаем сообщение через polling).
3. Создаётся `Task`, и тем же flow — синхронно, до уведомления менеджеру — мы шлём автоответ через `POST /messenger/v1/accounts/{user_id}/chats/{chat_id}/messages` в **тот же чат**.

Endpoint и payload:
```http
POST https://api.avito.ru/messenger/v1/accounts/{user_id}/chats/{chat_id}/messages
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "message": { "text": "Здравствуйте! Спасибо за обращение..." },
  "type": "text"
}
```

### Q2: Webhook Messenger — доступность на тарифах Avito Pro

**Ответ:** Webhook'и Messenger API задокументированы для всех тарифов с включённым `messenger` scope в Avito Pro кабинете, но в SLA Avito Pro нет гарантии доставки — webhook'и могут теряться при сбоях, и Avito не делает retry с экспоненциальным backoff (только пара попыток в первые секунды).

**Регистрация webhook'а:**
```http
POST https://api.avito.ru/messenger/v1/webhooks/subscribe
{ "url": "https://delovoy-park.ru/api/avito/webhook/messenger?token={WEBHOOK_SECRET}" }
```

**Помечено для проверки в ЛК Avito (Operations TODO для DevOps/SUPERADMIN):**
- Подтвердить, что текущий тариф Avito Pro парка включает `messenger` scope.
- Подтвердить, что webhook subscription активна и URL зарегистрирован.
- Получить значение `user_id` парка через `GET /core/v1/accounts/self` (см. Q4) и сохранить в `AvitoIntegration`.

**Graceful fallback (обязательный, не опциональный):** Cron-скрипт `/api/cron/avito-messenger-poll` каждые 30 секунд (через системный cron, шаг отдельный от существующего `/api/cron/*`) дёргает:
```http
GET /messenger/v3/accounts/{user_id}/chats?unread_only=true&item_ids={avitoItemId,...}
```
и для каждого непрочитанного чата — `GET /messenger/v3/accounts/{user_id}/chats/{chat_id}/messages?limit=20` с фильтрацией по `created > lastSyncedAt`. Это даёт нам:
- Защиту от потерянных webhook'ов.
- Работоспособность, если webhook отключён в ЛК Avito.
- Дедуп через `AvitoMessage.avitoMessageId` UNIQUE — webhook и polling не задвоят сообщение.

Polling включается ENV-флагом `AVITO_MESSENGER_POLL_ENABLED=true` и работает параллельно с webhook'ом. В норме (webhook жив) polling будет находить только сообщения из редких window'ов между потерянным webhook'ом и следующим polling-тиком.

### Q3: Dedup-ключ для Task

**Решение:** дедуп по `(avitoChatId, taskStatus != closed/done)` в окне **30 дней с момента последнего сообщения**.

Обоснование:
- `chatId` в Avito Messenger — устойчивый идентификатор пары (покупатель × объявление). Один и тот же покупатель про одно и то же объявление = один `chatId` навсегда. Один и тот же покупатель про другое объявление = другой `chatId`.
- Это покрывает кейс «один покупатель — разные объявления»: разные `chatId` → разные Task (как и хочет PRD US-2.1 AC-4).
- Окно 30 дней решает кейс «покупатель вернулся через месяц»: если предыдущая задача закрыта **и** последнее сообщение было > 30 дней назад — создаём новый Task. Иначе — добавляем comment к существующему открытому Task. 30 дней — компромисс: достаточно, чтобы менеджер успел продать, и достаточно мало, чтобы возвратный лид через квартал считался свежим.

**Алгоритм при входящем сообщении:**
```
1. Найти AvitoMessage по avitoMessageId UNIQUE → если есть, выйти (idempotency).
2. Найти открытый Task по metadata.avitoChatId == chatId AND closedAt IS NULL.
   2a. Если нашли — добавить TaskComment, обновить task.updatedAt.
3. Если не нашли — найти последний закрытый Task по metadata.avitoChatId.
   3a. Если последнее сообщение в нём было < 30 дней назад → reopen (вернуть в первую колонку board) и добавить comment.
   3b. Иначе — создать новый Task.
4. В обоих случаях создать AvitoMessage с UNIQUE avitoMessageId.
```

Решение о reopen vs new task — конфигурируемая константа `AVITO_LEAD_REOPEN_WINDOW_DAYS=30` (не ENV — захардкоженно с TODO вынести в `Module.config.avito` если потребуется тонкая настройка).

### Q4: Стратегия миграции `AVITO_ITEM_ID` → `AvitoItem`

**Цель:** zero-downtime миграция, обратная совместимость `getAvitoItemStats()` для `src/app/admin/gazebos/marketing/page.tsx`.

**План (3 шага в одном PR):**

1. **Schema migration (additive only):** добавить таблицы `AvitoItem`, `AvitoIntegration`, `AvitoMessage`, `AvitoReview`, `AvitoCallEvent`. ENV `AVITO_ITEM_ID` не удаляется.

2. **Seed-скрипт `prisma/seed-avito.ts`:** идемпотентный, читает `process.env.AVITO_ITEM_ID`, если установлен и `AvitoItem` пустой — создаёт первую запись:
   ```ts
   await prisma.avitoItem.upsert({
     where: { avitoItemId: process.env.AVITO_ITEM_ID! },
     update: {},
     create: {
       avitoItemId: process.env.AVITO_ITEM_ID!,
       moduleSlug: "gazebos",
       title: "Беседка (legacy import)",
       isActive: true,
       lastSyncedAt: null,
     },
   });
   ```
   Запускается в production вручную после `prisma migrate deploy`.

3. **`src/lib/avito/items.ts` (новый файл) + рефакторинг `src/lib/avito.ts`:**
   - Старая сигнатура сохраняется:
     ```ts
     export async function getAvitoItemStats(dateFrom: string, dateTo: string): Promise<AvitoMarketingStats>
     ```
   - Внутри: если в БД есть `AvitoItem` с `moduleSlug='gazebos'` и `isActive=true` — берёт `avitoItemId` оттуда (первый найденный). Иначе fallback на ENV. Если оба пустые — возвращает `{ configured: false }`.
   - Новая функция `getAvitoItemStatsByItemId(avitoItemId, dateFrom, dateTo)` — для использования из `/api/avito/items/:id/stats`.

**Через 2 релиза** (когда дашборд `/admin/avito` стабилен и все объявления заведены) — отдельным PR удаляем `AVITO_ITEM_ID` из ENV и из `isConfigured()`.

---

## Варианты архитектуры

### Вариант A: Расширяем `src/lib/avito.ts` дробя на под-файлы (выбран)

```
src/lib/avito/
  index.ts            # реэкспорт + getAvitoItemStats (legacy compat)
  client.ts           # OAuth2 token + low-level fetch wrapper с retry/backoff
  items.ts            # реестр объявлений + per-item stats
  messenger.ts        # Messenger API: send, list chats, list messages
  reviews.ts          # Reviews API
  calls.ts            # Call-tracking API
  account.ts          # /core/v1/accounts/self, balance
  webhook-security.ts # constant-time secret compare, HMAC verify
  types.ts            # все типы
```

API-роуты в `src/app/api/avito/*`, UI в `src/app/admin/avito/*`. Всё, что относится к каналу уведомлений — в `src/modules/notifications/dispatch/channels/avito.ts` (как требует PRD US-2.3 / US-4.1).

**Плюсы:**
- Соблюдает scope-guard CLAUDE.md (не создаём новый бизнес-модуль).
- Изоляция: каждый файл < 200 строк, легко покрывать тестами.
- Avito-канал в общей dispatch-инфраструктуре — нулевой кастом в Tasks/Notifications.

**Минусы:**
- Логика лидов/задач (создание `Task`, маршрутизация по `moduleSlug`) живёт в `src/lib/avito/messenger.ts`, что технически — бизнес-логика. Митигация: эта логика ограничена ровно "превратить webhook payload в Task через существующий tasks-сервис", и вызывает `tasksService.createFromExternal(...)` — никаких новых концепций.

### Вариант B: Создаём `src/modules/avito/`

**Плюсы:** «правильно» по структуре проекта, единое место для бизнес-логики Avito.

**Минусы:**
- Прямо запрещён в PRD ("Вне скоупа") и противоречит scope-guard CLAUDE.md.
- Avito — не бизнес-домен (нет своих `Booking`/`Resource`), а интеграция-обёртка. Создание модуля = scope creep.

→ Отклонено.

### Вариант C: Webhook-only без polling fallback

**Плюсы:** проще на 30%, нет cron'а.

**Минусы:** при сбое webhook'а или отключении в ЛК Avito лиды теряются — это прямо нарушает главную метрику успеха PRD ("Пропущенные лиды < 10%"). Risk acceptance не оправдан.

→ Отклонено.

---

## Решение

Выбран **Вариант A** + dual-mode webhook+polling + dedup по `chatId` + 30-дневное окно reopen. Avito-канал реализуется как новый `INotificationChannel` с `kind: AVITO` (требует расширения enum `NotificationChannelKind`).

---

## 1. Схема БД (Prisma)

### 1.1. Расширение enum

```prisma
enum NotificationChannelKind {
  TELEGRAM
  EMAIL
  WHATSAPP
  MAX
  IMESSAGE
  SMS
  PUSH
  VK
  AVITO   // NEW
}
```

Миграция: `ALTER TYPE "NotificationChannelKind" ADD VALUE 'AVITO';` — Postgres-safe, additive.

### 1.2. Новые модели

```prisma
// === AVITO INTEGRATION ===

/// Один аккаунт парка в Avito. Singleton (id="default").
/// avitoUserId — числовой id аккаунта, нужен для Messenger API.
/// webhookSecret — генерируется при первом setup, ротируется через UI.
model AvitoIntegration {
  id                String    @id @default("default")
  avitoUserId       String?            // user_id из GET /core/v1/accounts/self
  accountName       String?
  webhookSecret     String?            // Используется как ?token=… в URL webhook
  webhookSecretRotatedAt DateTime?
  webhookEnabled    Boolean   @default(false)
  pollEnabled       Boolean   @default(true)
  lastBalanceRub    Decimal?           // Snapshot последней синхронизации баланса
  lastBalanceSyncAt DateTime?
  lastAccountSyncAt DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
}

/// Реестр объявлений парка. Привязка к moduleSlug управляет видимостью у MANAGER
/// и маршрутизацией лидов/звонков в Tasks.
model AvitoItem {
  id              String    @id @default(cuid())
  avitoItemId     String    @unique          // числовой ID объявления Avito (string for safety)
  title           String
  url             String?
  status          AvitoItemStatus @default(ACTIVE)
  moduleSlug      String?                    // "gazebos" | "ps-park" | null (без модуля)
  category        String?                    // "Аренда" | "Услуги" | … (из Avito)
  priceRub        Decimal?
  // Метрики кэшируются здесь, чтобы UI не дёргал Avito API на каждый клик.
  // Обновляется cron'ом каждые 15 мин и при ручном refresh.
  lastSyncedAt    DateTime?
  lastSyncError   String?   @db.Text
  // Денормализованный rating для US-3.2 — обновляется при reviews sync.
  avgRating       Float?
  reviewsCount    Int       @default(0)
  // Soft delete — если объявление удалено в Avito или администратор скрыл его.
  deletedAt       DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  messages        AvitoMessage[]
  reviews         AvitoReview[]
  callEvents      AvitoCallEvent[]
  statsSnapshots  AvitoItemStatsSnapshot[]

  @@index([moduleSlug, status])
  @@index([deletedAt])
}

enum AvitoItemStatus {
  ACTIVE
  ARCHIVED      // снято с публикации
  BLOCKED       // заблокировано Авито
  REMOVED       // удалено навсегда
}

/// Кэш входящих и исходящих сообщений Messenger.
/// Главная роль — idempotency для webhook (avitoMessageId UNIQUE)
/// и аудит для US-2.6 (хронология ответов).
/// taskCommentId — обратная ссылка на комментарий, который был создан из этого
/// сообщения (или который породил это сообщение — для исходящих).
model AvitoMessage {
  id              String    @id @default(cuid())
  avitoMessageId  String    @unique           // id сообщения от Avito
  avitoChatId     String                      // id чата
  avitoItemId     String?
  avitoItem       AvitoItem? @relation(fields: [avitoItemId], references: [id], onDelete: SetNull)
  direction       AvitoMessageDirection
  authorAvitoUserId String?                   // числовой user_id отправителя
  authorName      String?
  body            String    @db.Text
  attachments     Json?                       // raw images/links from payload
  // Связь с Task — для исходящих авто-ответов и ручных ответов.
  taskId          String?
  taskCommentId   String?                     // reference, не FK (FK не нужен — Task delete cascades comments)
  // Сырой payload Avito — на 30 дней (для разборок при изменении формата).
  rawPayload      Json?
  receivedAt      DateTime                    // время по часам Avito
  createdAt       DateTime  @default(now())

  @@index([avitoChatId, receivedAt])
  @@index([avitoItemId])
  @@index([taskId])
  @@index([direction, createdAt])
}

enum AvitoMessageDirection {
  INBOUND       // от клиента к нам
  OUTBOUND      // от нас (менеджер или auto-reply) к клиенту
}

/// Отзывы — для US-3.1 (alert), US-3.2 (avg rating).
/// Sync каждый час cron'ом /api/cron/avito-reviews-sync.
model AvitoReview {
  id              String    @id @default(cuid())
  avitoReviewId   String    @unique
  avitoItemId     String
  avitoItem       AvitoItem @relation(fields: [avitoItemId], references: [id], onDelete: Cascade)
  rating          Int                          // 1..5
  authorName      String?
  body            String?   @db.Text
  reviewedAt      DateTime
  alertSent       Boolean   @default(false)    // защита от повторного alert по US-3.1 AC-4
  createdAt       DateTime  @default(now())

  @@index([avitoItemId, rating])
  @@index([alertSent, rating])
  @@index([reviewedAt])
}

/// События по звонкам call-tracking.
/// Для US-4.1 (пропущенные звонки). Для агрегатных метрик дашборда
/// можно использовать существующий getAvitoItemStats (call-tracking summary).
model AvitoCallEvent {
  id              String    @id @default(cuid())
  avitoCallId     String    @unique           // id звонка
  avitoItemId     String?
  avitoItem       AvitoItem? @relation(fields: [avitoItemId], references: [id], onDelete: SetNull)
  callerPhone     String?                     // если Avito передаёт
  status          AvitoCallStatus
  durationSec     Int?
  startedAt       DateTime
  taskId          String?                     // для пропущенных звонков
  rawPayload      Json?
  createdAt       DateTime  @default(now())

  @@index([avitoItemId, status])
  @@index([startedAt])
  @@index([taskId])
}

enum AvitoCallStatus {
  ANSWERED
  MISSED
  REJECTED
  FAILED
}

/// Снапшоты метрик за период — кэш для US-1.3.
/// (period='7d'|'30d', dateFrom..dateTo, метрики).
/// Обновляется cron'ом раз в 15 мин. UI читает только отсюда.
model AvitoItemStatsSnapshot {
  id              String    @id @default(cuid())
  avitoItemId     String
  avitoItem       AvitoItem @relation(fields: [avitoItemId], references: [id], onDelete: Cascade)
  period          String                       // "7d" | "30d"
  dateFrom        DateTime
  dateTo          DateTime
  views           Int       @default(0)
  uniqViews       Int       @default(0)
  contacts        Int       @default(0)
  favorites       Int       @default(0)
  calls           Int       @default(0)
  missedCalls     Int       @default(0)
  syncedAt        DateTime  @default(now())

  @@unique([avitoItemId, period])
  @@index([syncedAt])
}
```

### 1.3. Расширения существующих моделей (без структурных изменений)

**`Task.metadata`** — соглашение о форме (без миграции, просто документация типа в `src/lib/avito/types.ts`):

```ts
type TaskAvitoMetadata = {
  source: "avito";
  kind: "lead" | "missed_call";
  avitoItemId: string;     // FK на AvitoItem.id (наш cuid)
  avitoChatId?: string;    // только для kind=lead
  avitoCallId?: string;    // только для kind=missed_call
  itemUrl?: string;
  chatUrl?: string;
  lastInboundAt?: string;  // ISO — для расчёта 30-day reopen window
};
```

`Task.source` уже имеет значение `API` — используем его. `externalContact` (Json уже есть в схеме) хранит `{ avitoUserId, name, phone? }`.

**Новые `TaskCategory`** (создаются seed-скриптом `prisma/seed-avito-categories.ts`):

| slug | name | defaultBoardId | priorityHint | keywords |
|---|---|---|---|---|
| `avito-lead-gazebos` | Авито лид: Барбекю Парк | (gazebos board id) | HIGH | [] |
| `avito-lead-ps-park` | Авито лид: PS Park | (ps-park board id) | HIGH | [] |
| `avito-lead-unassigned` | Авито лид: без модуля | (default board) | MEDIUM | [] |
| `avito-missed-call-gazebos` | Пропущенный звонок: Барбекю | (gazebos board) | HIGH | [] |
| `avito-missed-call-ps-park` | Пропущенный звонок: PS Park | (ps-park board) | HIGH | [] |
| `avito-missed-call-unassigned` | Пропущенный звонок: без модуля | (default) | HIGH | [] |

Keyword-маршрутизация Phase 5.4 нам не нужна — маршрутизируем по `AvitoItem.moduleSlug` напрямую.

### 1.4. Миграция

Один Prisma migration файл `prisma/migrations/<timestamp>_avito_integration/migration.sql`:
1. `ALTER TYPE "NotificationChannelKind" ADD VALUE 'AVITO';`
2. `CREATE TYPE "AvitoItemStatus" AS ENUM ...;` `CREATE TYPE "AvitoMessageDirection" ...;` `CREATE TYPE "AvitoCallStatus" ...;`
3. `CREATE TABLE "AvitoIntegration" ...;` (singleton — одна строка с id='default' инсертится в data-migration шаге).
4. `CREATE TABLE "AvitoItem" ...;` + индексы.
5. `CREATE TABLE "AvitoMessage" ...;` + индексы + UNIQUE `avitoMessageId`.
6. `CREATE TABLE "AvitoReview" ...;` + индексы.
7. `CREATE TABLE "AvitoCallEvent" ...;` + индексы.
8. `CREATE TABLE "AvitoItemStatsSnapshot" ...;` + UNIQUE `(avitoItemId, period)`.
9. Data-migration: `INSERT INTO "AvitoIntegration"(id, "createdAt", "updatedAt") VALUES('default', NOW(), NOW()) ON CONFLICT DO NOTHING;`

`AVITO_ITEM_ID` ENV — НЕ удаляется в этой миграции (см. Q4). Удаление через 2 релиза отдельным PR.

---

## 2. API-контракты

Все ответы — стандартный `apiResponse()`/`apiError()`. RBAC выполняется в начале handler через `auth()` + `hasModuleAccess(...)` / `hasAdminSectionAccess(...)`.

### 2.1. `GET /api/avito/items`

Список объявлений с фильтром по модулю.

- **Auth:** SUPERADMIN или MANAGER/ADMIN с `hasAdminSectionAccess(userId, "avito")` ИЛИ `hasModuleAccess(userId, queryModule)`.
- **Query:** `?moduleSlug=gazebos|ps-park|none|all` (default — `all` для SUPERADMIN, иначе модуль из назначений менеджера).
- **Rate limit:** 60/min на пользователя.
- **Response (200):**
  ```json
  {
    "success": true,
    "data": {
      "items": [
        {
          "id": "ckxyz...",
          "avitoItemId": "1234567890",
          "title": "Беседка с мангалом — Селятино",
          "url": "https://avito.ru/...",
          "status": "ACTIVE",
          "moduleSlug": "gazebos",
          "priceRub": "5000.00",
          "lastSyncedAt": "2026-04-28T12:00:00Z",
          "stats": {
            "period": "7d",
            "views": 1234, "uniqViews": 800, "contacts": 45,
            "favorites": 12, "calls": 8, "missedCalls": 2,
            "syncedAt": "2026-04-28T12:00:00Z"
          },
          "avgRating": 4.7,
          "reviewsCount": 23
        }
      ]
    }
  }
  ```

### 2.2. `PATCH /api/avito/items/:id`

Привязка объявления к модулю (US-1.2).

- **Auth:** SUPERADMIN only.
- **Body:** Zod-схема `{ moduleSlug: z.enum(["gazebos", "ps-park"]).nullable() }`.
- **Audit:** запись в `AuditLog` с action `avito.item.updateModule`.
- **Errors:** `404 NOT_FOUND` если `id` не существует; `403 FORBIDDEN` для не-SUPERADMIN; `400 VALIDATION_ERROR` если moduleSlug не в whitelist.

### 2.3. `GET /api/avito/items/:id/stats`

Статистика по объявлению с заданным периодом.

- **Auth:** SUPERADMIN или MANAGER/ADMIN при `hasModuleAccess(userId, item.moduleSlug)`.
- **Query:** `?period=7d|30d` (Zod), `?compare=true` (опционально — отдаёт дельту к предыдущему периоду).
- **Источник:** читает только из `AvitoItemStatsSnapshot`. **Не дёргает Avito API синхронно.** Если snapshot старше 30 минут — возвращает с флагом `stale: true`, фронт показывает плашку "обновляется". Реальный refresh — через cron или `POST /api/avito/items/:id/refresh`.
- **Rate limit:** 60/min.

### 2.4. `POST /api/avito/items/:id/refresh`

Принудительный refresh stats для объявления.

- **Auth:** SUPERADMIN или MANAGER/ADMIN с доступом к модулю.
- **Rate limit:** **5/min на пользователя** + **20/min глобально на объявление** (защита от Avito 429).
- **Action:** дёргает `getAvitoItemStatsByItemId(...)`, обновляет snapshot, возвращает свежие данные.

### 2.5. `GET /api/avito/account/balance`

Баланс кошелька и информация об аккаунте (US-1.4).

- **Auth:** **SUPERADMIN only.**
- **Источник:** читает из `AvitoIntegration.lastBalanceRub` (snapshot). Refresh — через cron `/api/cron/avito-balance-sync` раз в час.
- **Response:** `{ balanceRub, lowBalanceWarning: balance < 500, lastSyncAt, accountName }`.

### 2.6. `POST /api/avito/webhook/messenger`

**Публичный** (без NextAuth). Защищён secret-токеном в URL.

- **Path:** `/api/avito/webhook/messenger`
- **Query:** `?token={WEBHOOK_SECRET}` (constant-time compare с `AvitoIntegration.webhookSecret`).
- **Body:** raw JSON от Avito, формат:
  ```json
  {
    "id": "msg-uuid",
    "version": "v3.0.0",
    "timestamp": 1714300000,
    "payload": {
      "type": "message",
      "value": {
        "id": "...", "chat_id": "...", "user_id": 12345,
        "author_id": 67890, "created": 1714300000,
        "type": "text", "content": { "text": "..." },
        "item_id": 1234567890
      }
    }
  }
  ```
- **Response:** **всегда 200 OK** в течение 5 секунд (даже при ошибке обработки) — иначе Avito будет ретраить штормом.
- **Действия (атомарно):**
  1. Проверить токен. Невалидный → 200 OK + WARNING в SystemEvent (не 401, чтобы не помогать брутфорсу через response-codes).
  2. Дедуп: `INSERT ... ON CONFLICT DO NOTHING` в `AvitoMessage` по `avitoMessageId`. Если конфликт — 200 OK без побочных эффектов.
  3. Найти/создать Task по правилу из Q3.
  4. Отправить автоответ через Avito Messenger API (если включён в `Module.config.avito.autoReplyEnabled`).
  5. Через `NotificationDispatcher.dispatch(...)` уведомить менеджера (`avito.lead.new`).
  6. Записать `TaskComment` (visibleToReporter=false, source=API).
- **Rate limit:** 10 req/sec на ключ `avito:webhook:msg:{ip}` (Redis sliding window). **Превышение → 200 OK + WARNING** (не 429 — Avito интерпретирует как failure).

### 2.7. `POST /api/avito/webhook/calls`

**Публичный.** Аналогично 2.6 — secret-токен, idempotency по `avitoCallId`, всегда 200 OK.

### 2.8. `POST /api/avito/webhook/reviews`

**Публичный.** Опционально — если Avito поддерживает webhook на отзывы (помечено для проверки в ЛК). Иначе — только cron-sync (US-3.1 AC-1: "раз в час").

### 2.9. `POST /api/tasks/:id/avito/reply`

Отправка ответа в Avito Messenger из карточки Task (US-2.2).

- **Auth:** MANAGER (через `hasModuleAccess(userId, task.metadata.moduleSlug)`), ADMIN, SUPERADMIN.
- **Body:** Zod `{ text: z.string().min(1).max(2000) }`.
- **Errors:**
  - `400 INVALID_TASK` — task.metadata.source != "avito" или нет `avitoChatId`.
  - `502 AVITO_API_ERROR` — если Avito вернул ошибку (с `error.details.avitoStatus`).
  - `429 RATE_LIMITED` — на наш rate-limiter (10/min на пользователя по этому endpoint).
- **Действия:**
  1. Дёргает Messenger API send.
  2. На успех — создаёт `TaskComment` (source=MANUAL, authorUserId=session.user.id), `AvitoMessage` (direction=OUTBOUND), `TaskEvent` (kind=COMMENT_ADDED, metadata={ avitoSent: true }), запись в `AuditLog` (action="avito.message.send").
  3. На ошибку — логирует в `SystemEvent` (level=ERROR), возвращает `502` с возможностью повторить.

### 2.10. `GET /api/avito/reviews`

Список отзывов с фильтрами (Этап 3, US-3.2).

- **Auth:** SUPERADMIN или MANAGER/ADMIN с `hasModuleAccess(userId, queryModule)`.
- **Query:** `?moduleSlug=...&minRating=1&maxRating=5&from=&to=`.
- **Response:** список `AvitoReview` + агрегированный avg rating.

### 2.11. `GET /api/avito/metrics/response-time`

Метрики US-2.4 / US-2.5.

- **Auth:** SUPERADMIN.
- **Query:** `?moduleSlug=...&period=7d|30d`.
- **Расчёт:** на лету из `Task` + `TaskComment` + `AvitoMessage` (без отдельной таблицы, MVP). Кэш в Redis 5 минут.
- **Response:** `{ avgResponseSeconds, percentRespondedIn1h, sampleSize, businessHoursOnly: true }`.

### 2.12. Cron endpoints (внутренние, `x-cron-secret` header)

- `POST /api/cron/avito-stats-sync` — раз в 15 мин. Обновляет `AvitoItemStatsSnapshot` для всех ACTIVE объявлений.
- `POST /api/cron/avito-account-sync` — раз в час. Обновляет список `AvitoItem` через `GET /core/v1/items` + balance.
- `POST /api/cron/avito-reviews-sync` — раз в час. Тянет отзывы по всем `AvitoItem`, для новых с rating ≤ 3 диспатчит `avito.review.negative`.
- `POST /api/cron/avito-messenger-poll` — каждые 30 сек если `AvitoIntegration.pollEnabled=true`. Fallback к webhook'у.

Все cron'ы — отдельный PR's gating через `process.env.AVITO_CRON_ENABLED`. Защита: `x-cron-secret` header (как в существующих cron'ах проекта).

---

## 3. Zod-схемы (структура)

В `src/lib/avito/validation.ts`:

```ts
export const AvitoItemAssignSchema = z.object({
  moduleSlug: z.enum(["gazebos", "ps-park"]).nullable(),
});

export const AvitoStatsQuerySchema = z.object({
  period: z.enum(["7d", "30d"]).default("7d"),
  compare: z.coerce.boolean().optional(),
});

export const AvitoReplySchema = z.object({
  text: z.string().min(1).max(2000),
});

// Webhook payload schemas — только то, что нам нужно. Лишние поля игнорируем.
export const AvitoMessengerWebhookSchema = z.object({
  id: z.string(),
  version: z.string().optional(),
  timestamp: z.number(),
  payload: z.object({
    type: z.literal("message"),
    value: z.object({
      id: z.string(),
      chat_id: z.string(),
      user_id: z.number(),
      author_id: z.number(),
      created: z.number(),
      type: z.string(),
      content: z.object({ text: z.string().optional() }).passthrough(),
      item_id: z.number().optional(),
    }),
  }),
});

export const AvitoCallWebhookSchema = z.object({
  id: z.string(),
  payload: z.object({
    type: z.enum(["call.missed", "call.answered", "call.failed"]),
    value: z.object({
      call_id: z.string(),
      item_id: z.number().optional(),
      caller_phone: z.string().optional(),
      duration: z.number().optional(),
      started_at: z.number(),
    }),
  }),
});

export const AvitoErrorSchema = z.object({
  code: z.enum([
    "AVITO_NOT_CONFIGURED",
    "AVITO_API_ERROR",
    "AVITO_TOKEN_INVALID",
    "AVITO_RATE_LIMITED",
    "AVITO_ITEM_NOT_FOUND",
    "AVITO_CHAT_NOT_FOUND",
    "AVITO_MODULE_FORBIDDEN",
    "WEBHOOK_INVALID_TOKEN",
  ]),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
```

Стандартные ответы об ошибках через `apiError(code, message, status, details)`. Никаких stack-trace'ов в response.

---

## 4. AvitoChannel — реализация `INotificationChannel`

Файл: `src/modules/notifications/dispatch/channels/avito.ts`.

### Концепция

`UserNotificationChannel` для Avito-канала — это **per-Task** контейнер, а не per-User: «адресом» канала является `chat_id` Avito, который привязан к конкретному покупателю. Это нестандартное использование (обычно address = telegram chat id пользователя в нашей системе), поэтому требует отдельной semantics:

- **Получатель уведомлений `avito.lead.new` / `avito.call.missed` — менеджер в нашей системе**, не покупатель в Avito. Эти события идут через **TelegramChannel** (по `eventType` в `NotificationEventPreference`). Avito-канал тут ни при чём.
- **Avito-канал нужен только для исходящих сообщений к покупателю** (auto-reply US-2.3, manual reply US-2.2). Это инициируется из бизнес-логики (webhook handler / reply API), а не из `dispatch()`.

### Решение

Avito-канал реализуется как `INotificationChannel`, но **не используется в обычном `dispatch()`-потоке для menager notifications.** Вместо этого:

1. Регистрируется в `ChannelRegistry` для возможности будущего использования (например, send to chat from cron-эскалация).
2. Адрес канала — `chatId` (а не stable user identifier).
3. Используется **напрямую** через `ChannelRegistry.get("AVITO").send(chatId, payload)` в:
   - `src/lib/avito/messenger.ts` → `sendAutoReply(task)` после создания Task.
   - `POST /api/tasks/:id/avito/reply` — после валидации.
4. `UserNotificationChannel` записи для `kind=AVITO` **не создаются** в этой итерации (нет user-level subscription к Avito). При попытке создать — endpoint `/api/users/me/channels` отдаст `400 CHANNEL_NOT_SUBSCRIBABLE`.

### Скелет

```ts
// src/modules/notifications/dispatch/channels/avito.ts
import type { NotificationChannelKind } from "@prisma/client";
import { sendMessage } from "@/lib/avito/messenger";
import type { DeliveryResult, INotificationChannel, NotificationPayload } from "../types";

export class AvitoChannel implements INotificationChannel {
  readonly kind: NotificationChannelKind = "AVITO";

  isAvailable(): boolean {
    return Boolean(
      process.env.AVITO_CLIENT_ID && process.env.AVITO_CLIENT_SECRET
    );
    // avitoUserId проверяется в sendMessage — если нет, вернёт retryable=false.
  }

  /**
   * address формат: "chatId:itemId" — itemId нужен для логирования AvitoMessage.
   * Используется только для исходящих к покупателю в существующий чат.
   */
  async send(address: string, payload: NotificationPayload): Promise<DeliveryResult> {
    const [chatId, itemId] = address.split(":");
    if (!chatId) return { ok: false, reason: "chatId missing", retryable: false };

    const text = `${payload.title}\n\n${payload.body}` +
      (payload.actions?.[0]?.url ? `\n\n${payload.actions[0].url}` : "");

    return sendMessage({ chatId, itemId, text });
    // sendMessage возвращает DeliveryResult с правильной классификацией retryable
    // (HTTP 5xx/429 → retryable=true; 4xx → retryable=false).
  }
}
```

### Регистрация

В `src/modules/notifications/dispatch/channels/index.ts`:

```ts
import { AvitoChannel } from "./avito";
// ...
ChannelRegistry.register(new AvitoChannel());
```

### Quiet hours, dedup, retry

- Авто-ответы и manual replies — НЕ через `dispatch()` (он гонит через `OutgoingNotification` queue, что для исходящих в чат с покупателем избыточно: задержка 30+ сек в quiet hours = провал US-2.3 «60 секунд»).
- Реализация — синхронный вызов `sendMessage()` с **внутренним retry** (3 попытки, exponential backoff 1s/3s/9s) и записью в `AvitoMessage` независимо от результата (чтобы не задвоить при следующей попытке).

---

## 5. Webhook security & idempotency

### Secret-токен

```
URL: /api/avito/webhook/messenger?token=<random64hex>
```

- Генерация: `crypto.randomBytes(32).toString("hex")` при первом setup, хранится в `AvitoIntegration.webhookSecret`.
- Сравнение: `crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(stored))` — constant-time.
- Ротация: `POST /api/avito/integration/rotate-webhook-secret` (SUPERADMIN only). После ротации SUPERADMIN обновляет URL в ЛК Avito — это manual step, документируется в Operations runbook.
- Старый секрет не оставляется параллельно — старт ротации = инвалидация.

### HMAC

В публичной документации Avito **HMAC-подписи webhook'ов не задокументированы** (помечено для проверки в ЛК Avito — возможно, доступно для enterprise tier). При обнаружении HMAC-заголовка `X-Avito-Signature` в payload — реализуем верификацию в `src/lib/avito/webhook-security.ts` с поддержкой обоих способов (token-only fallback).

### Idempotency

- `AvitoMessage.avitoMessageId` UNIQUE — Postgres UNIQUE constraint, race-safe.
- Pseudocode handler:
  ```ts
  try {
    await prisma.avitoMessage.create({ data: { avitoMessageId, ... }});
  } catch (e) {
    if (isPrismaUniqueError(e)) return apiResponse({ idempotent: true });
    throw e;
  }
  // proceed to create Task / autoreply
  ```
- Полностью защищает от повторных POST'ов — Avito может ретраить, мы всегда 200 OK без побочных эффектов.

### Rate limit на webhook

- Redis sliding window: ключ `avito:webhook:msg:{ip}`, 10 req/sec.
- Превышение → **200 OK + WARNING в SystemEvent** (не 429), чтобы Avito не считал нас сломанными.

### Защита от SSRF / open redirect

Webhook handler **не делает исходящих fetch'ей** на основе входных данных. URLs, на которые идут наши запросы (Avito API), захардкожены в `src/lib/avito/client.ts`. Никаких `fetch(payload.callback_url)` или подобного.

### Защита от replay

`timestamp` в payload Avito → если разница с `now()` > 5 минут — **WARNING** в SystemEvent, но **обрабатываем** (т.к. polling fallback может приносить старые сообщения легитимно). Дедуп по `avitoMessageId` всё равно решает реальный replay.

---

## 6. Стратегия rate limits Avito API

### Документированные/наблюдаемые лимиты

- **Token endpoint** (`/token`): мягкий лимит, на практике 10 req/min достаточно. Кэш токена в Redis на 23.5 ч уже есть — этого хватает.
- **`/stats/v1/...`**: ~60 req/min на аккаунт (наблюдение, не SLA).
- **`/messenger/v1/...`** (send): ~30 req/min на аккаунт; превышение даёт 429.
- **`/messenger/v3/...`** (read chats/messages): ~120 req/min.
- **`/core/v1/items`**: ~30 req/min.

**Помечено для проверки в ЛК Avito** (Operations TODO): запросить актуальные лимиты у saas-менеджера или через support; если получим официальные числа — обновить ENV-конфиги ниже.

### Митигации

1. **Кэш в Redis на token** — уже реализовано (23.5 ч).
2. **Snapshot stats в БД** (`AvitoItemStatsSnapshot`) — UI читает только из БД, Avito API не дёргается на каждом клике. Cron обновляет раз в 15 мин.
3. **Manual refresh rate-limit** — 5/min на пользователя + 20/min глобально на объявление (см. 2.4).
4. **Backoff на 429:** `retry-after` заголовок, exponential backoff `1s → 3s → 9s → 27s`, max 4 попытки. Реализация в `src/lib/avito/client.ts` как `fetchWithRetry()`.
5. **Очередь при 429:** для исходящих сообщений — если Avito возвращает 429, помещаем в `OutgoingNotification` через AvitoChannel с `scheduledFor = now() + retry-after`. Чтобы это работало для авто-ответов (которые обычно идут синхронно), при первом 429 переключаем именно эти исходящие в queue + логируем CRITICAL.

---

## 7. Phasing — порядок 4 PR

Каждый PR — одна фича, в духе scope-guard CLAUDE.md.

### PR-1: Migration + Items Dashboard (Этап 1, US-1.1 — US-1.4)

**Сложность:** M (3-4 дня).

**Файлы:**
- `prisma/schema.prisma` — добавить модели Avito*, расширить `NotificationChannelKind` enum.
- `prisma/migrations/<ts>_avito_integration/migration.sql` — DDL.
- `prisma/seed-avito.ts` + `prisma/seed-avito-categories.ts` — seed-скрипты.
- `src/lib/avito/index.ts`, `src/lib/avito/client.ts`, `src/lib/avito/items.ts`, `src/lib/avito/account.ts`, `src/lib/avito/types.ts`, `src/lib/avito/validation.ts`.
- Удаление `src/lib/avito.ts` → re-export из `src/lib/avito/index.ts` (legacy compat).
- `src/app/api/avito/items/route.ts`, `src/app/api/avito/items/[id]/route.ts`, `src/app/api/avito/items/[id]/stats/route.ts`, `src/app/api/avito/items/[id]/refresh/route.ts`, `src/app/api/avito/account/balance/route.ts`.
- `src/app/api/cron/avito-stats-sync/route.ts`, `src/app/api/cron/avito-account-sync/route.ts`.
- `src/app/admin/avito/page.tsx` — главная страница (список объявлений + balance card).
- `src/app/admin/avito/items/[id]/page.tsx` — детали объявления (метрики 7д/30д, дельта).
- `src/lib/permissions.ts` — добавить `avito` в `ADMIN_SECTIONS`.
- `CLAUDE.md` — добавить `avito` в "Реальный список модулей" как **integration** (не модуль), отметить, что `src/modules/avito/` нет.
- Тесты: `src/lib/avito/__tests__/items.test.ts`, `client.test.ts`, route handlers' integration tests с mocked Avito API.

**Что тестировать:**
- Unit: token caching, fetchWithRetry retry/backoff, getAvitoItemStatsByItemId, percentile/delta calculation.
- Integration: GET /api/avito/items (RBAC matrix: SUPERADMIN, MANAGER gazebos, MANAGER ps-park, USER), PATCH assign module + AuditLog, refresh rate limit.
- E2E (smoke): /admin/avito загружается, manager видит только свои объявления.

### PR-2: Messenger Integration (Этап 2, US-2.1 — US-2.5)

**Сложность:** L (5-7 дней) — самый сложный PR.

**Файлы:**
- `src/lib/avito/messenger.ts` — sendMessage, listChats, listMessages, sendAutoReply, parseInboundWebhook.
- `src/lib/avito/webhook-security.ts` — token compare, optional HMAC.
- `src/modules/notifications/dispatch/channels/avito.ts` — `AvitoChannel` impl + регистрация в bootstrap.
- `src/lib/avito/lead-routing.ts` — логика создания/реоупа Task из inbound message (Q3 algorithm).
- `src/app/api/avito/webhook/messenger/route.ts` — публичный endpoint.
- `src/app/api/tasks/[id]/avito/reply/route.ts` — отправка ответа.
- `src/app/api/cron/avito-messenger-poll/route.ts` — fallback polling.
- `src/app/api/avito/metrics/response-time/route.ts` — US-2.4 / 2.5.
- UI: расширение карточки Task — секция "Ответить в Авито" (если `metadata.source === "avito"`).
- Расширение `Module.config.avito` через UI — toggle auto-reply + текст-шаблон (на странице `/admin/avito/settings`).
- Регистрация event types в `notification-events.ts`: `avito.lead.new` (Telegram default), `avito.call.missed`.

**Что тестировать:**
- Unit: dedup алгоритм (3 ветки: открытый Task / reopen / new), AvitoChannel.send error mapping, parseInboundWebhook Zod validation, autoreply template substitution.
- Integration: webhook with valid/invalid token, idempotent retry of same message (Avito retry simulation), auto-reply flow, response-time metric calculation in working hours.
- Race-test: два webhook'а на одно сообщение одновременно — дедуп через UNIQUE.
- Mock Avito API через `nock` или `vi.mock("@/lib/avito/client")`.

### PR-3: Reviews Sync + Negative Alert (Этап 3, US-3.1, US-3.2)

**Сложность:** S (1-2 дня).

**Файлы:**
- `src/lib/avito/reviews.ts` — fetchReviews, syncReviews.
- `src/app/api/cron/avito-reviews-sync/route.ts`.
- `src/app/api/avito/reviews/route.ts`.
- Регистрация event type `avito.review.negative`.
- UI: блок отзывов на `/admin/avito/items/[id]`.

**Что тестировать:**
- Unit: `alertSent` guard от повторных уведомлений, avg rating calculation.
- Integration: cron создаёт OutgoingNotification только для новых reviews ≤ 3 ⭐.

### PR-4: Call Tracking (Этап 4, US-4.1)

**Сложность:** S (1-2 дня).

**Файлы:**
- `src/lib/avito/calls.ts` — parseCallWebhook, syncMissedCallsBatch.
- `src/app/api/avito/webhook/calls/route.ts`.
- `src/lib/avito/lead-routing.ts` — extension: `createTaskFromMissedCall(callEvent)` с phone-lookup в `User`/`Tenant`.
- Регистрация event type `avito.call.missed`.

**Что тестировать:**
- Unit: phone normalization + lookup user/tenant, idempotency по `avitoCallId`.
- Integration: webhook flow → Task created → notification sent.

---

## 8. Риски и митигации

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| **Rate limits Avito API** при пиковой нагрузке | Средняя | Средний | Snapshot stats в БД (cron 15 мин), manual refresh лимитирован 5/min. Backoff `fetchWithRetry`. |
| **Тариф Avito не поддерживает Messenger webhook** | Средняя | Высокий | Polling fallback каждые 30 сек реализован в PR-2 безусловно. Webhook — оптимизация, не блокер. |
| **Миграция БД на проде** | Низкая | Высокий | Все изменения additive (новые таблицы, ADD VALUE для enum). ENV `AVITO_ITEM_ID` сохраняется для backward compat. Откат — `prisma migrate resolve`. |
| **Webhook secret leak через git/логи** | Низкая | Высокий | Secret хранится только в БД, не в ENV. Не логируется. Маскируется в `SystemEvent.metadata`. Ротация через UI. |
| **Объявление удалили в Avito, Task осталась "висеть"** | Высокая | Низкий | Cron `avito-account-sync` помечает удалённые `AvitoItem` как `REMOVED`. Открытые Task'и остаются (менеджер сам решает закрыть) — дополняем comment'ом "Объявление удалено в Avito" один раз. |
| **Покупатель отправил спам через Авито Messenger → Task создан, авто-ответ ушёл** | Средняя | Низкий | `Module.config.avito.autoReplyEnabled` toggle. SUPERADMIN может выключить. Long-term — keyword blacklist на обработке inbound (не в MVP). |
| **Менеджер ответил из приложения Avito (не из платформы) → race с авто-ответом** | Средняя | Низкий | Авто-ответ кидается в течение секунд после inbound — менеджер физически не успеет. Если успел — AvitoMessage UNIQUE спасёт от дублей в кеше. Двойной ответ клиенту — приемлемо для MVP. |
| **Avito изменил формат payload без объявления** | Низкая | Средний | `rawPayload` Json сохраняется на 30 дней. Zod-схема использует `.passthrough()` где допустимо. Парсинг-ошибка → WARNING в SystemEvent + 200 OK Avito. |
| **AVITO_CRON_ENABLED включили в проде до настройки webhook secret** | Низкая | Низкий | Cron'ы проверяют `AvitoIntegration.webhookSecret` для polling — если нет, no-op + INFO лог. |
| **Менеджер пытается ответить на закрытый чат в Avito (клиент удалил)** | Низкая | Низкий | API Avito вернёт 4xx → `502 AVITO_API_ERROR` с `details.avitoStatus`. UI показывает "Чат недоступен". Task не блокируется. |

---

## 9. RBAC summary (для security review)

| Endpoint | SUPERADMIN | ADMIN | MANAGER | USER | Public |
|---|---|---|---|---|---|
| `GET /api/avito/items` | all | section-checked | own moduleSlug only | ❌ | ❌ |
| `PATCH /api/avito/items/:id` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `GET /api/avito/items/:id/stats` | ✅ | section-checked | own moduleSlug only | ❌ | ❌ |
| `POST /api/avito/items/:id/refresh` | ✅ | section-checked | own moduleSlug only | ❌ | ❌ |
| `GET /api/avito/account/balance` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/avito/webhook/messenger` | — | — | — | — | ✅ token-protected |
| `POST /api/avito/webhook/calls` | — | — | — | — | ✅ token-protected |
| `POST /api/tasks/:id/avito/reply` | ✅ | section-checked | own moduleSlug | ❌ | ❌ |
| `GET /api/avito/reviews` | ✅ | section-checked | own moduleSlug | ❌ | ❌ |
| `GET /api/avito/metrics/response-time` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/avito/integration/rotate-webhook-secret` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `POST /api/cron/avito-*` | — | — | — | — | ✅ x-cron-secret |

Для каждого endpoint в Developer-задаче явно прописать:
- `auth()` → если null → 401 (или skip для public webhook'ов).
- Role check.
- `hasModuleAccess(...)` если нужен.
- Zod validation.
- `apiError()` через стандартный helper.
- Rate limit (см. секцию 2 для значений).
- Audit log на любой POST/PATCH/DELETE.

---

## 10. Operations runbook (для DevOps/SUPERADMIN перед запуском)

1. ✅ Проверить в ЛК Avito Pro что включён `messenger` scope.
2. ✅ Получить `avitoUserId` через `GET /core/v1/accounts/self` и сохранить через `/admin/avito/settings`.
3. ✅ Сгенерировать webhook secret через `/admin/avito/integration/rotate-webhook-secret`.
4. ✅ В ЛК Avito Pro зарегистрировать webhook URL: `https://delovoy-park.ru/api/avito/webhook/messenger?token=<secret>`.
5. ✅ Запустить seed `npx tsx prisma/seed-avito.ts` для миграции `AVITO_ITEM_ID`.
6. ✅ Запустить seed `npx tsx prisma/seed-avito-categories.ts`.
7. ✅ В админке `/admin/avito` привязать каждое объявление к своему модулю (US-1.2).
8. ✅ В Module.config Барбекю Парка и PS Park включить auto-reply + задать текст-шаблон.
9. ✅ Включить `AVITO_CRON_ENABLED=true` в production ENV.
10. ✅ Назначить `NotificationEventPreference` для events `avito.lead.new`, `avito.call.missed`, `avito.review.negative` каждому MANAGER'у соответствующего модуля.

---

## 11. Чеклист для Developer

- [ ] Schema migration written и проверен на staging.
- [ ] Все API endpoints с RBAC из секции 9.
- [ ] Все Zod-схемы из секции 3.
- [ ] AvitoChannel зарегистрирован в `bootstrapChannels`.
- [ ] Webhook idempotency через UNIQUE constraint.
- [ ] Webhook security: token constant-time compare.
- [ ] Cron'ы под флагом `AVITO_CRON_ENABLED`.
- [ ] Backward compat: `getAvitoItemStats(dateFrom, dateTo)` сохранена для `gazebos/marketing/page.tsx`.
- [ ] Тесты: unit для всех в `src/lib/avito/__tests__/`, integration для всех route handlers, race-test на дедуп.
- [ ] Audit log в `AuditLog` для PATCH/POST мутаций.
- [ ] CLAUDE.md обновлён в том же PR (PR-1) — добавить "avito" как integration в "Реальный список модулей" с пометкой "не в `src/modules/`".
- [ ] Operations runbook (секция 10) добавлен в `docs/operations/avito-setup.md`.
