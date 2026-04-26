# ADR: «Задачи Делового» — единый канбан + channel-agnostic уведомления

**Дата:** 2026-04-26
**RUN_ID:** 2026-04-26-tasks-kanban
**Автор:** System Architect (agent)
**Статус:** Принято, готово к реализации
**PRD:** `docs/requirements/2026-04-26-tasks-kanban-prd.md`

---

## 1. Контекст и решение

Сегодня операционные задачи парка «Деловой» живут в Telegram-чатах и Excel, а жалобы арендаторов — в WhatsApp и звонках. Попытка PR #178 разделить трекер на `Task.type ∈ {INTERNAL, ISSUE}` показала, что это **один и тот же процесс**: проблема с сантехникой в офисе 205 — это задача с ответственным, дедлайном и колонкой, независимо от того, кто её создал. Дискриминатор `type` плодит дублирующую логику (две разные проверки RBAC, две разные нотификации, два UI-экрана) и навязывает поведение, которое в реальности должно настраиваться менеджером (категория, ответственный по умолчанию, цвет, SLA).

**Решение:** один модуль `tasks` с настраиваемыми досками (`TaskBoard`) и колонками (`TaskColumn`) — как в Bitrix24 / Jira / Linear. Источник задачи хранится как метаданные (`source ∈ MANUAL/TELEGRAM/EMAIL/WEB/API`), репортёр — как опциональный `reporterUserId` или `externalContact JSON`. Вместо одиночного `assigneeUserId` — связь many-to-many `TaskAssignee` с ролями (RESPONSIBLE/COLLABORATOR/WATCHER), потому что заявленная матрица уведомлений и поведение «один ответственный + соисполнители + наблюдатели» иначе не выражается без денормализации.

**Channel-agnostic notifications.** Существующий модуль `notifications` имеет жёстко зашитую цепочку «AUTO → Telegram → email» в коде вызова, плюс enum `NotificationChannel` хранит конкретный канал в `NotificationPreference.preferredChannel`. Это ломается при появлении WhatsApp/MAX/SMS — каждый канал = ручная правка диспатчеров в каждом модуле. Решение: ввести **новую** сущность `UserNotificationChannel` (per-user адреса каналов, до N штук, с приоритетом) и интерфейс `INotificationChannel` (3 метода: `send`, `verify?`, `isAvailable`). `NotificationDispatcher` зависит только от интерфейса; добавление WhatsApp = новый класс + строка в `ChannelRegistry.register(...)`, ноль правок в модуле tasks. Существующий enum `NotificationChannel` переименовываем в `NotificationChannelKind` (тот же набор + `MAX`, `IMESSAGE`, `SMS`, `PUSH`); существующие модели `NotificationPreference`/`NotificationLog` мигрируем на новую схему с обратной совместимостью (см. Migration plan).

**Почему отдельная сущность `OutgoingNotification` вместо логирования постфактум:** требование AC-059 (quiet hours → DEFERRED) и AC-024 (idempotency) превращает уведомление из fire-and-forget в стейтфул-объект с retry, dedup-ключом и отложенной отправкой. Это очередь, не лог.

---

## 2. Полная Prisma-схема

### 2.1 Enums

```prisma
enum TaskSource {
  MANUAL    // создано в админке
  TELEGRAM  // /issue в боте
  EMAIL     // IMAP inbound
  WEB       // публичная форма /report
  API       // POST /api/tasks (внешние интеграции)
}

enum TaskPriority {
  NONE
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum TaskAssigneeRole {
  RESPONSIBLE
  COLLABORATOR
  WATCHER
}

enum TaskEventKind {
  CREATED
  STATUS_CHANGED        // (зарезервировано — фактически используем COLUMN_CHANGED)
  COLUMN_CHANGED
  COLUMN_REORDERED      // sortOrder в колонке
  ASSIGNEE_ADDED
  ASSIGNEE_REMOVED
  ASSIGNEE_ROLE_CHANGED
  CATEGORY_CHANGED
  PRIORITY_CHANGED
  DUE_CHANGED
  TITLE_CHANGED
  DESCRIPTION_CHANGED
  LABEL_ADDED
  LABEL_REMOVED
  COMMENT_ADDED
  REPORTER_LINKED
  ATTACHMENT_ADDED
}

enum TaskCommentSource {
  MANUAL
  EMAIL
  TELEGRAM
  PUBLIC_TRACK   // комментарий с /track от авторизованного репортёра
  SYSTEM         // системные сообщения (auto-reassign, etc.)
}

enum NotificationChannelKind {
  TELEGRAM
  EMAIL
  WHATSAPP    // stub V1
  MAX         // stub V1
  IMESSAGE    // stub V1
  SMS         // stub V1
  PUSH        // stub V1 (web push)
  VK          // legacy compat
}

enum OutgoingNotificationStatus {
  PENDING     // ждёт отправки воркером
  DEFERRED    // попало в quiet hours, отправится позже
  SENT
  FAILED      // все retry исчерпаны
  SKIPPED     // dedup или DND
}

enum NotificationSubscriptionScope {
  TASK
  BOARD
  CATEGORY
}
```

### 2.2 Tasks core

```prisma
model TaskBoard {
  id          String  @id @default(cuid())
  slug        String  @unique  // "general", "ops", "ps-park"
  name        String
  description String?
  isDefault   Boolean @default(false)
  sortOrder   Int     @default(0)
  isArchived  Boolean @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  columns TaskColumn[]
  tasks   Task[]

  @@index([isArchived, sortOrder])
}

model TaskColumn {
  id         String  @id @default(cuid())
  boardId    String
  board      TaskBoard @relation(fields: [boardId], references: [id], onDelete: Cascade)
  name       String
  color      String  @default("#9CA3AF")  // hex
  sortOrder  Int     @default(0)
  isTerminal Boolean @default(false)
  wipLimit   Int?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  tasks Task[]

  @@unique([boardId, sortOrder])
  @@index([boardId])
}

model TaskCategory {
  id                       String   @id @default(cuid())
  slug                     String   @unique  // "rental", "cafe", "ps-park", "cleaning", "security", "it", "uncategorized"
  name                     String
  description              String?
  color                    String   @default("#9CA3AF")
  defaultBoardId           String?              // если категория должна попадать в определённую доску
  defaultResponsibleUserId String?
  keywords                 String[] @default([]) // substring match для авто-категоризации
  priorityHint             TaskPriority @default(NONE)
  sortOrder                Int      @default(0)
  isArchived               Boolean  @default(false)
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt

  tasks Task[]

  @@index([isArchived])
}

model Task {
  id              String      @id @default(cuid())
  publicId        String      @unique             // "TASK-XXXXX" base32 без 0/1/I/O
  boardId         String
  board           TaskBoard   @relation(fields: [boardId], references: [id])
  columnId        String
  column          TaskColumn  @relation(fields: [columnId], references: [id])
  categoryId      String?
  category        TaskCategory? @relation(fields: [categoryId], references: [id])
  title           String      @db.VarChar(200)
  description     String?     @db.Text
  priority        TaskPriority @default(NONE)
  dueAt           DateTime?
  labels          String[]    @default([])
  source          TaskSource
  reporterUserId  String?                         // внутренний репортёр
  reporter        User?       @relation("TaskReporter", fields: [reporterUserId], references: [id])
  externalContact Json?                           // { name?, email?, phone?, officeNumber? } для source=WEB/EMAIL без аккаунта
  officeId        String?                         // привязка к офису через office-matcher
  office          Office?     @relation(fields: [officeId], references: [id])
  sortOrder       Float       @default(0)         // позиция в колонке (фракционное число)
  closedAt        DateTime?                       // выставляется при попадании в колонку с isTerminal=true
  deletedAt       DateTime?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  assignees     TaskAssignee[]
  comments      TaskComment[]
  events        TaskEvent[]
  subscriptions TaskSubscription[]

  @@index([boardId, columnId, sortOrder])         // главный канбан-запрос
  @@index([categoryId])
  @@index([reporterUserId])
  @@index([officeId])
  @@index([source])
  @@index([dueAt])                                // для просроченных
  @@index([closedAt])
  @@index([deletedAt])
}

model TaskAssignee {
  id         String           @id @default(cuid())
  taskId     String
  task       Task             @relation(fields: [taskId], references: [id], onDelete: Cascade)
  userId     String
  user       User             @relation(fields: [userId], references: [id])
  role       TaskAssigneeRole
  assignedAt DateTime         @default(now())
  assignedById String?

  @@unique([taskId, userId])                      // один user — одна роль на задаче
  @@index([userId, role])                          // «мои задачи» по роли
  @@index([taskId])
}

model TaskComment {
  id                 String            @id @default(cuid())
  taskId             String
  task               Task              @relation(fields: [taskId], references: [id], onDelete: Cascade)
  authorUserId       String?
  author             User?             @relation("TaskCommentAuthor", fields: [authorUserId], references: [id])
  externalAuthor     Json?             // { name?, email? } для inbound email от незарегистрированного отправителя
  body               String            @db.Text
  visibleToReporter  Boolean           @default(false)
  attachments        Json?             // [{ url, filename, size, mimeType }]
  source             TaskCommentSource @default(MANUAL)
  emailMessageId     String?           @unique     // RFC Message-ID для idempotency inbound email
  inReplyToCommentId String?
  createdAt          DateTime          @default(now())
  updatedAt          DateTime          @updatedAt

  @@index([taskId, createdAt])
  @@index([authorUserId])
}

model TaskEvent {
  id           String        @id @default(cuid())
  taskId       String
  task         Task          @relation(fields: [taskId], references: [id], onDelete: Cascade)
  actorUserId  String?
  actor        User?         @relation("TaskEventActor", fields: [actorUserId], references: [id])
  kind         TaskEventKind
  metadata     Json?         // { from, to, fieldName, ... } зависит от kind
  createdAt    DateTime      @default(now())

  @@index([taskId, createdAt])
  @@index([actorUserId])
  @@index([kind, createdAt])
}

model TaskSubscription {
  id           String                          @id @default(cuid())
  userId       String
  user         User                            @relation("TaskSubUser", fields: [userId], references: [id], onDelete: Cascade)
  scope        NotificationSubscriptionScope
  taskId       String?
  task         Task?                           @relation(fields: [taskId], references: [id], onDelete: Cascade)
  boardId      String?
  categoryId   String?
  eventKinds   TaskEventKind[]                 @default([])  // пусто = все
  createdAt    DateTime                        @default(now())

  @@unique([userId, scope, taskId, boardId, categoryId])
  @@index([userId])
  @@index([scope, taskId])
  @@index([scope, boardId])
  @@index([scope, categoryId])
}

model SavedTaskView {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation("SavedTaskViewUser", fields: [userId], references: [id], onDelete: Cascade)
  boardId   String?                              // null = «все доски»
  name      String   @db.VarChar(80)
  filters   Json                                  // { categoryIds[], labels[], priorities[], assigneeIds[], dateRange, swimlane }
  isShared  Boolean  @default(false)              // V2 — пока всегда false, поле зарезервировано
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId, boardId])
}
```

### 2.3 Channel-agnostic notifications

```prisma
model UserNotificationChannel {
  id          String                  @id @default(cuid())
  userId      String
  user        User                    @relation("UNCUser", fields: [userId], references: [id], onDelete: Cascade)
  kind        NotificationChannelKind
  address     String                  // tg chat_id, email, phone, …
  label       String?                 // «Личный email», «Рабочий Telegram»
  priority    Int                     @default(100)  // 1=primary, 2=fallback, …
  isActive    Boolean                 @default(true)
  verifiedAt  DateTime?
  verificationCodeHash String?         // bcrypt от 6-значного кода
  verificationExpiresAt DateTime?
  verificationAttempts Int              @default(0)
  createdAt   DateTime                @default(now())
  updatedAt   DateTime                @updatedAt

  outgoing OutgoingNotification[]

  @@unique([userId, kind, address])
  @@index([userId, isActive, priority])
  @@index([kind])
}

// Per-user, per-event-type настройки. Заменяет старый NotificationPreference (миграция данных см. ниже).
model NotificationEventPreference {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation("NEPUser", fields: [userId], references: [id], onDelete: Cascade)
  eventType       String                                 // "task.assigned", "task.column_changed", "task.comment_added", "task.mention", "task.due_soon", "task.closed_for_reporter", …
  enabled         Boolean  @default(true)
  channelKinds    NotificationChannelKind[] @default([]) // пусто = primary канал юзера
  quietHoursFrom  String?                                // "HH:MM"
  quietHoursTo    String?
  quietWeekdaysOnly Boolean @default(false)
  timezone        String   @default("Europe/Moscow")
  dndUntil        DateTime?                              // временный DND
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([userId, eventType])
  @@index([userId])
}

// Глобальные настройки пользователя (для DND «бессрочно» и общего timezone, если eventType-настройки нет)
model NotificationGlobalPreference {
  userId          String   @id
  user            User     @relation("NGPUser", fields: [userId], references: [id], onDelete: Cascade)
  timezone        String   @default("Europe/Moscow")
  quietHoursFrom  String?
  quietHoursTo    String?
  dndUntil        DateTime?
  updatedAt       DateTime @updatedAt
}

model OutgoingNotification {
  id              String                       @id @default(cuid())
  userId          String                       // получатель
  eventType       String
  entityType      String?                      // "Task", "TaskComment"
  entityId        String?
  channelId       String                       // FK на UserNotificationChannel
  channel         UserNotificationChannel      @relation(fields: [channelId], references: [id])
  payload         Json                         // { title, body, actions[], metadata }
  status          OutgoingNotificationStatus   @default(PENDING)
  attempts        Int                          @default(0)
  maxAttempts     Int                          @default(3)
  scheduledFor    DateTime                     @default(now())  // для DEFERRED — конец quiet hours
  sentAt          DateTime?
  failureReason   String?                      @db.Text
  dedupKey        String                       // sha256(userId|eventType|entityId|payloadHash)
  createdAt       DateTime                     @default(now())
  updatedAt       DateTime                     @updatedAt

  @@index([status, scheduledFor])              // hot path воркера
  @@index([dedupKey, createdAt])               // dedup lookup
  @@index([userId, createdAt])                 // история на UI
  @@index([entityType, entityId])
}
```

### 2.4 Индексы — обоснование критичных

| Индекс | Зачем |
|---|---|
| `Task @@index([boardId, columnId, sortOrder])` | основной запрос канбана: «все задачи доски, сгруппированные по колонкам, в правильном порядке» |
| `Task @@index([dueAt])` | подсчёт просроченных (AC-076) и dashboard-счётчики (AC-075) |
| `TaskAssignee @@index([userId, role])` | «мои задачи как RESPONSIBLE» — самый частый фильтр сотрудника |
| `TaskComment.emailMessageId UNIQUE` | идемпотентность IMAP inbound (AC-024) — на уровне БД, не приложения |
| `OutgoingNotification @@index([status, scheduledFor])` | воркер каждую минуту делает `WHERE status IN (PENDING,DEFERRED) AND scheduledFor<=NOW()` |
| `OutgoingNotification @@index([dedupKey, createdAt])` | dedup-окно 5 минут (AC: точечный lookup при dispatch) |

---

## 3. Migration plan

Одна миграция `20260426000000_tasks_kanban_and_channel_agnostic_notifications`.

### 3.1 Создать новые модели

Все таблицы Section 2.2 + 2.3.

### 3.2 Seed дефолтных данных (отдельный seed-блок, не в migration.sql)

`prisma/seed-tasks.ts` (вызывается из `scripts/seed.ts` идемпотентно через `upsert` по `slug`):

**TaskBoard:**
- `general` — «Задачи Делового», `isDefault=true`

**TaskColumn (для general):**
| name | color | sortOrder | isTerminal | wipLimit |
|---|---|---|---|---|
| Входящие | #6B7280 | 0 | false | — |
| Триаж | #F59E0B | 1 | false | — |
| В работе | #3B82F6 | 2 | false | 10 |
| Ждём ответа | #A855F7 | 3 | false | — |
| Готово | #10B981 | 4 | true | — |
| Архив | #4B5563 | 5 | true | — |

**TaskCategory (slug, name, keywords):**
- `rental` — «Аренда», `["аренда","офис","договор","оплата"]`
- `cafe` — «Кафе», `["кафе","меню","заказ","еда"]`
- `ps-park` — «PS Park», `["плейстейшн","ps","столик","геймпад"]`
- `gazebos` — «Беседки», `["беседка","мангал","дрова"]`
- `parking` — «Парковка», `["парковка","машина","шлагбаум"]`
- `cleaning` — «Уборка», `["уборка","грязно","мусор","туалет"]`
- `security` — «Безопасность», `["охрана","видеонаблюдение","ключ"]`
- `it` — «IT», `["wi-fi","wifi","интернет","связь","роутер"]`
- `uncategorized` — «Без категории» (fallback, AC-066)

### 3.3 Миграция legacy `notifications`

Текущие модели: `NotificationPreference`, `NotificationLog`, enum `NotificationChannel`.

**Стратегия — двухшаговая:**

1. **В этой миграции:** создаём `UserNotificationChannel`, `NotificationEventPreference`, `NotificationGlobalPreference`, `OutgoingNotification`, `NotificationChannelKind`, `OutgoingNotificationStatus`. Старые `NotificationPreference` и `NotificationLog` **оставляем нетронутыми** (не удаляем, не переименовываем). Старый enum `NotificationChannel` сохраняем; в новом коде используется `NotificationChannelKind` с теми же значениями + новые (`MAX`, `IMESSAGE`, `SMS`, `PUSH`).
2. **Backfill data-migration script** `scripts/migrate-notification-prefs.ts` (запускается один раз вручную): для каждого `NotificationPreference` создаёт один `NotificationGlobalPreference` (timezone) и для верифицированного Telegram/email юзера — `UserNotificationChannel` с `priority=1` и `verifiedAt=NOW()`.
3. **В следующей итерации (вне scope V1):** удаление старых таблиц, после того как все модули перейдут на новый Dispatcher.

**Обратная совместимость:** новый `NotificationDispatcher` экспортирует thin-shim с тем же API, что использовали кафе/беседки/ps-park (`notify(userId, eventType, payload)`). Внутри shim вызывает новый pipeline. Старые модули продолжают работать без правок.

### 3.4 Существующие модули не мигрируем в Tasks

`FeedbackItem` остаётся как есть (отдельный модуль). `ManagerTask` (rental) — отдельная сущность для просроченных платежей, не сливаем. Сценариев миграции данных нет, потому что Tasks — новый модуль.

---

## 4. Channel-agnostic notification architecture

### 4.1 Интерфейс канала

```ts
// src/modules/notifications/types.ts

export type NotificationAction = {
  label: string;
  url?: string;             // ссылка
  callback?: string;        // для TG inline keyboard, опционально
};

export type NotificationPayload = {
  title: string;
  body: string;             // markdown-like, каналы рендерят по-своему
  actions?: NotificationAction[];
  metadata?: Record<string, unknown>;  // entityType/entityId для аналитики
};

export type DeliveryResult =
  | { ok: true; externalId?: string }
  | { ok: false; reason: string; retryable: boolean };

export type VerificationChallenge = {
  method: "code" | "link";
  hint: string;             // «Код выслан на email», «Перейди по ссылке»
  expiresAt: Date;
};

export interface INotificationChannel {
  readonly kind: NotificationChannelKind;
  isAvailable(): boolean;
  send(address: string, payload: NotificationPayload): Promise<DeliveryResult>;
  verify?(address: string): Promise<VerificationChallenge>;
  confirmVerification?(address: string, code: string): Promise<boolean>;
}
```

### 4.2 ChannelRegistry

Singleton, регистрирует все каналы при старте (`src/modules/notifications/channel-registry.ts`):

```ts
ChannelRegistry.register(new TelegramChannel(env.TELEGRAM_BOT_TOKEN));
ChannelRegistry.register(new EmailChannel(env.SMTP_*));
ChannelRegistry.register(new WhatsAppChannelStub());
ChannelRegistry.register(new MaxChannelStub());
ChannelRegistry.register(new IMessageChannelStub());
ChannelRegistry.register(new SmsChannelStub());
```

API:
- `ChannelRegistry.get(kind): INotificationChannel | undefined`
- `ChannelRegistry.available(): NotificationChannelKind[]`

### 4.3 Поток отправки — диаграмма

```
                 ┌───────────────┐
   business      │  TaskService  │  task.create / column-change / comment / mention
   event ───────▶│  emits event  │
                 └───────┬───────┘
                         ▼
              ┌──────────────────────┐
              │ NotificationDispatcher│
              │  .dispatch(event)     │
              └──────┬────────────────┘
                     │
                     ▼
        1. resolveSubscribers(event)
           - assignees (RESPONSIBLE/COLLABORATOR/WATCHER)
           - reporter
           - explicit TaskSubscription rows
           - mentions из payload
                     │
                     ▼
        2. для каждого userId:
           - load NotificationEventPreference + Global
           - check enabled / dndUntil / quiet hours
           - select channel: pref.channelKinds[0] или primary канал юзера
           - fallback по priority при channel.isAvailable()===false
                     │
                     ▼
        3. compute dedupKey = sha256(userId|eventType|entityId|payloadHash)
           lookup OutgoingNotification WHERE dedupKey=? AND createdAt > NOW()-5min
           AND status IN (SENT, PENDING, DEFERRED) → SKIP
                     │
                     ▼
        4. compute scheduledFor:
           - quiet hours? → конец окна (DEFERRED)
           - иначе → NOW (PENDING)
                     │
                     ▼
        5. INSERT OutgoingNotification (PENDING|DEFERRED)
                     │
       ──────────────┴──────────────
                     │
                     ▼
       ┌──────────────────────────────┐
       │  Worker (cron каждую минуту) │  src/modules/notifications/scheduler-hooks.ts
       │  WHERE status IN (PENDING,    │
       │   DEFERRED) AND scheduled<=NOW│
       │  LIMIT 100                    │
       └────────────┬─────────────────┘
                    ▼
       channel = ChannelRegistry.get(channelKind)
       result = await channel.send(address, payload)
                    │
              ok? ──┴── no ──▶ attempts++; if attempts>=max → FAILED;
              │                иначе → попытка fallback-канала на след. цикле
              ▼
            SENT (sentAt=NOW)
```

### 4.4 Stubs

`WhatsAppChannelStub`, `MaxChannelStub`, `IMessageChannelStub`, `SmsChannelStub`: `isAvailable()===false`, `send()` возвращает `{ok:false, reason:"channel not configured", retryable:false}` и логирует WARNING в `SystemEvent`. Это чтобы Dispatcher не упал, если кто-то ошибочно проставит этот канал primary.

### 4.5 Shim для legacy модулей

`src/modules/notifications/legacy.ts`:

```ts
export async function notify(userId: string, eventType: string, payload: NotificationPayload) {
  return NotificationDispatcher.dispatch({
    userId,
    eventType,
    entityType: payload.metadata?.entityType as string | undefined,
    entityId: payload.metadata?.entityId as string | undefined,
    payload,
  });
}
```

Кафе/беседки/ps-park продолжают вызывать `notify(...)` без правок.

---

## 5. API-контракты

Единый формат ответа: `{ success: true, data, meta? }` / `{ success:false, error:{code,message} }` (см. CLAUDE.md). Все мутации логируются в `AuditLog`.

### 5.1 Tasks — CRUD и канбан

| Метод | Путь | RBAC | Rate limit |
|---|---|---|---|
| GET | `/api/tasks` | ADMIN+, MANAGER (своя доска), USER (где он assignee/reporter) | 120/min/user |
| POST | `/api/tasks` | MANAGER+ | 60/min/user |
| GET | `/api/tasks/:publicId` | участник или ADMIN+ или reporter | 120/min/user |
| PATCH | `/api/tasks/:publicId` | RESPONSIBLE / ADMIN+ / MANAGER (если в его доске) | 60/min/user |
| DELETE | `/api/tasks/:publicId` | ADMIN+ (soft delete) | 30/min/user |
| PATCH | `/api/tasks/:publicId/column` | участник / ADMIN+ / MANAGER | 120/min/user |
| PATCH | `/api/tasks/:publicId/order` | участник / ADMIN+ / MANAGER | 120/min/user |

`GET /api/tasks` query params: `boardId`, `columnId`, `categoryId`, `assigneeId`, `assigneeRole`, `source`, `priority[]`, `labels[]`, `q` (full-text on title/description), `dueFrom`, `dueTo`, `createdFrom`, `createdTo`, `overdue=true`, `page`, `limit`.

`POST /api/tasks` request (Zod `createTaskSchema`):
```json
{
  "boardId": "string?", "columnId": "string?", "categoryId": "string?",
  "title": "string (1..200)", "description": "string?",
  "priority": "NONE|LOW|MEDIUM|HIGH|CRITICAL?",
  "dueAt": "ISO8601?", "labels": ["string"],
  "responsibleUserId": "string?",
  "collaboratorUserIds": ["string"]<=10,
  "watcherUserIds": ["string"]<=20,
  "officeId": "string?"
}
```
Response 201: `{ success:true, data: <full Task DTO> }`.

`PATCH /api/tasks/:publicId/column` request (Zod):
```json
{ "columnId": "string", "sortOrder": "number?" }
```
Response 200: `{ success:true, data:{ publicId, columnId, sortOrder } }`.
Side effect: `TaskEvent COLUMN_CHANGED`, dispatch уведомлений всем участникам, если новая колонка `isTerminal=true` — `closedAt=NOW` и уведомление reporter (AC-071).

`PATCH /api/tasks/:publicId/order` — частный случай для drag-n-drop внутри колонки. Принимает `sortOrder: number` (фракционный). Альтернатива — `beforeId`/`afterId` (lex-fractional indexing); выбираем числовой Float для V1, ребалансировка при перестройке (`ребалансировка batch job` отдельной фоновой задачей раз в неделю).

### 5.2 Assignees

| Метод | Путь | RBAC | Rate |
|---|---|---|---|
| POST | `/api/tasks/:publicId/assignees` | RESPONSIBLE / ADMIN+ | 60/min |
| DELETE | `/api/tasks/:publicId/assignees/:userId` | RESPONSIBLE / ADMIN+ | 60/min |
| PATCH | `/api/tasks/:publicId/assignees/:userId` | ADMIN+ (смена роли) | 30/min |

Body: `{ userId, role: RESPONSIBLE|COLLABORATOR|WATCHER }`. На один `taskId+userId` одна запись (см. unique constraint). Если назначаем нового RESPONSIBLE при существующем — старого либо переводим в COLLABORATOR (флаг `demoteCurrent: boolean`), либо отказ 409.

### 5.3 Comments

| Метод | Путь | RBAC | Rate |
|---|---|---|---|
| GET | `/api/tasks/:publicId/comments` | участник / ADMIN+ / reporter (только visibleToReporter=true) | 120/min |
| POST | `/api/tasks/:publicId/comments` | участник / ADMIN+ | 60/min |

Body: `{ body: string (1..10000), visibleToReporter: boolean=false, attachments?: [...] }`.
Mention parser извлекает `@username` → создаёт уведомления `task.mention`.

### 5.4 Events (timeline)

| GET | `/api/tasks/:publicId/events` | то же что GET task | 120/min |

### 5.5 Subscriptions

| POST/DELETE | `/api/tasks/:publicId/subscribe` | любой авторизованный USER | 60/min |
| POST/DELETE | `/api/tasks/boards/:slug/subscribe` | MANAGER+ | 30/min |

### 5.6 Boards / Columns / Categories admin

| GET | `/api/tasks/boards` | любой авторизованный | — |
| POST/PATCH/DELETE | `/api/tasks/boards[/:id]` | ADMIN+ | 30/min |
| POST/PATCH/DELETE | `/api/tasks/boards/:id/columns[/:colId]` | ADMIN+ | 60/min |
| GET | `/api/tasks/categories` | любой авторизованный | — |
| POST/PATCH/DELETE | `/api/tasks/categories[/:id]` | ADMIN+ | 30/min |

Удаление колонки с задачами → `409 COLUMN_NOT_EMPTY` (AC-032). Удаление последней колонки → `409 LAST_COLUMN` (AC-034).

### 5.7 Public form `/report`

| Метод | Путь | RBAC | Rate limit |
|---|---|---|---|
| POST | `/api/tasks/report` | public, anonymous | **5/час/IP** (AC-010), 20/час/IP soft cap |
| GET | `/api/tasks/report/office-suggest?q=` | public | 30/min/IP |
| GET | `/api/tasks/track/:publicId` | public + опционально email match | 30/min/IP |
| POST | `/api/tasks/track/:publicId/comment` | authenticated reporter (US-11 AC-070) | 10/min/user |

`POST /api/tasks/report` Zod (`reportTaskSchema`):
```json
{
  "description": "string (10..2000)",
  "officeNumber": "string? (regex)",
  "officeId": "string?",                // если уже выбран из autosuggest
  "name": "string (1..100)?",
  "email": "string (email)?",
  "phone": "string (E.164)?",
  "category": "string?",                // категория — slug, опционально
  "ambiguityResolution": "specific|unknown?"  // когда форма ре-сабмитится после OFFICE_AMBIGUOUS
}
```

Response 201:
```json
{ "success":true, "data":{ "publicId":"TASK-7K3X9", "trackingUrl":"/track/TASK-7K3X9" } }
```

Response 409 OFFICE_AMBIGUOUS:
```json
{ "success":false, "error":{
  "code":"OFFICE_AMBIGUOUS",
  "message":"Найдено несколько офисов с этим номером. Уточните.",
  "details":{ "candidates":[{ "id":"...", "label":"301А, 3 этаж, корпус 1" }, ...] }
}}
```

Response 429:
```json
{ "success":false, "error":{ "code":"RATE_LIMIT", "message":"Слишком много заявок. Попробуйте через час." }}
```

Side effects:
- Auto-categorization по keywords (substring case-insensitive match, AC-064).
- Если category.defaultResponsibleUserId — `TaskAssignee RESPONSIBLE` сразу (AC-065).
- Иначе → колонка «Входящие», category=`uncategorized` (AC-066).
- Если `email` указан — отправка email с trackingId через EmailChannel (AC-013).
- AuditLog.action=`task.report`, userId=`null`, metadata={ ip, ua }.

### 5.8 Notifications API

| Метод | Путь | RBAC | Rate |
|---|---|---|---|
| GET | `/api/notifications/channels` | self | 60/min |
| POST | `/api/notifications/channels` | self | 10/min — anti-spam при добавлении |
| DELETE | `/api/notifications/channels/:id` | self / ADMIN+ | 10/min |
| POST | `/api/notifications/channels/:id/verify` | self | 5/min |
| POST | `/api/notifications/channels/:id/confirm` | self | 5/min |
| GET | `/api/notifications/preferences` | self | 60/min |
| PUT | `/api/notifications/preferences` | self | 30/min |
| GET | `/api/notifications/outgoing` | self (свои) / ADMIN+ (все) | 60/min |

`POST /api/notifications/channels` body: `{ kind: NotificationChannelKind, address: string, label?: string, priority?: number }`. После создания — статус `verifiedAt=null`. Без верификации канал не используется Dispatcher'ом.

`POST /api/notifications/channels/:id/verify` — генерит код / deep-link, отправляет через сам канал. Возвращает `VerificationChallenge`.

`POST /api/notifications/channels/:id/confirm` body: `{ code: string }`. После 5 неудачных попыток — `verificationCodeHash=null`, requireRequest заново.

### 5.9 Saved views

| GET/POST/PATCH/DELETE | `/api/tasks/views[/:id]` | self | 60/min |

Server валидирует, что у юзера ≤ 10 видов (AC-045).

---

## 6. RBAC матрица (сводно)

| Endpoint | SUPERADMIN | ADMIN | MANAGER | USER (assignee) | USER (reporter) | Anonymous |
|---|---|---|---|---|---|---|
| GET /api/tasks | ✅ all | ✅ all | ✅ свои доски | ✅ свои задачи | ❌ | ❌ |
| POST /api/tasks | ✅ | ✅ | ✅ (доска назначена) | ❌ | ❌ | ❌ |
| GET /api/tasks/:id | ✅ | ✅ | ✅ если доска назначена | ✅ если assignee | ✅ если reporter | ❌ |
| PATCH /api/tasks/:id | ✅ | ✅ | ✅ если назначен | RESPONSIBLE only (subset полей) | ❌ | ❌ |
| DELETE | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| PATCH /column | ✅ | ✅ | ✅ если доска | ✅ если RESPONSIBLE/COLLABORATOR (AC-040) | ❌ | ❌ |
| POST /assignees | ✅ | ✅ | ✅ если назначен | RESPONSIBLE only | ❌ | ❌ |
| POST /comments | ✅ | ✅ | ✅ | ✅ если assignee | ✅ visibleToReporter=true (AC-070) | ❌ |
| Boards/Columns admin | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Categories admin | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| POST /api/tasks/report | — | — | — | — | — | ✅ rate limit |
| GET /api/tasks/track/:id | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ public |
| /api/notifications/channels (self) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| /api/notifications/outgoing (all) | ✅ | ✅ | ❌ | self | self | ❌ |

Проверки доступа реализуются в `service.ts` через хелпер `assertTaskAccess(userId, role, taskOrId)` и `hasModuleAccess(userId, "tasks")` для MANAGER (модуль `tasks` регистрируется в таблице `Module` через seed).

---

## 7. Rate limiting (Redis sliding window)

| Endpoint | Лимит | Ключ |
|---|---|---|
| `POST /api/tasks/report` | 5/час | `rl:tasks:report:ip:{ip}` (AC-010) |
| `GET /api/tasks/report/office-suggest` | 30/мин | `rl:tasks:office-suggest:ip:{ip}` |
| `GET /api/tasks/track/:id` | 30/мин | `rl:tasks:track:ip:{ip}` |
| `POST /api/tasks` | 60/мин | `rl:tasks:create:user:{userId}` |
| `PATCH /api/tasks/:id/column` | 120/мин | `rl:tasks:column:user:{userId}` |
| `POST /api/notifications/channels` | 10/мин | `rl:notif:channel-add:user:{userId}` |
| `POST /channels/:id/verify` | 5/мин | `rl:notif:verify:user:{userId}` |
| `POST /channels/:id/confirm` | 5/мин | `rl:notif:confirm:user:{userId}` (anti-bruteforce) |

Ошибки rate-limit — формат `{ success:false, error:{ code:"RATE_LIMIT", message:"<RU>" } }`, HTTP 429, header `Retry-After`.

---

## 8. Zod-схемы — план

В `src/modules/tasks/validation.ts`:
- `createTaskSchema`, `updateTaskSchema` (все поля optional, refine: хотя бы одно)
- `moveTaskColumnSchema`, `reorderTaskSchema`
- `addAssigneeSchema`, `updateAssigneeSchema`
- `createCommentSchema`, `updateCommentSchema`
- `taskListQuerySchema` (фильтры)
- `reportTaskSchema` (публичная — строже: `description.min(10)`, `email.email()`, `phone.regex(E.164)`, `description` ограничен по длине; rate-checked отдельно)
- `officeSuggestSchema`
- `boardSchema`, `columnSchema`, `categorySchema`
- `savedViewSchema`

В `src/modules/notifications/validation.ts`:
- `addChannelSchema` (`kind` enum, `address` validator зависит от kind: email/E.164/tg id)
- `verifyChannelSchema`, `confirmChannelSchema` (`code: regex /^\d{6}$/`)
- `eventPreferenceSchema`, `globalPreferenceSchema`
- `dispatchEventSchema` (внутренняя)

Формат ошибок валидации:
```json
{ "success":false, "error":{ "code":"VALIDATION_ERROR", "message":"...", "details":{ "field":"description", "issue":"min" } } }
```

---

## 9. Trade-offs и обоснования решений

| Решение | Альтернатива | Почему так |
|---|---|---|
| Один `Task` без `type` | `Task.type ∈ {INTERNAL, ISSUE}` (PR #178) | Дискриминатор плодит дублирующую логику. Категории + источник дают ту же выразительность без раздвоения. Подтверждено пользователем. |
| `TaskAssignee` m2m с ролью | `assigneeUserId` + `collaborators String[]` | PRD требует RESPONSIBLE/COLLABORATOR/WATCHER + матрицу уведомлений per-role. Денормализованный массив не индексируется и не позволяет историю «кто, когда, кем назначил». |
| `UserNotificationChannel` отдельно от старого `NotificationPreference` | Расширить `NotificationPreference` | Жизненный цикл разный: канал имеет адрес, верификацию, приоритет; preference — это «что и куда». Их 1:N. Старая модель остаётся для обратной совместимости (см. Migration). |
| `OutgoingNotification` как очередь, не лог | Логировать постфактум в `NotificationLog` | Quiet hours (DEFERRED) и retry требуют persistent state. Отсюда же — idempotency через `dedupKey`. |
| Float `sortOrder` в колонке | Lexicographic fractional indexing (string) | Float проще; ребалансировка раз в N перестановок (worker). Lex-индексы корректнее, но overkill для V1 при ожидаемых ≤ 1000 задач/доска. Описано как future-work. |
| IMAP polling, не webhooks | SES/Mailgun webhook | Yandex SMTP уже используется; IMAP poll каждые 60 секунд достаточно. Webhook — V2 если перейдём на провайдер с pub/sub. |
| Stub-каналы в коде | Просто отсутствуют | Гарантирует, что Dispatcher не упадёт, если в БД остался канал `WHATSAPP` после ручной правки. Stub отвечает `not configured`, а не throws. |
| `NotificationChannelKind` отдельный enum | Переиспользовать существующий `NotificationChannel` | Старый используется в legacy моделях. Чтобы не ломать миграцию — оставляем оба, новый код использует `Kind`. |
| Канбан-производительность | server-side pagination per column | До 1000 задач/доска — full load с client-side группировкой ОК. При росте — lazy load по колонкам. Отмечено как future-work. |
| Email `Message-ID` UNIQUE | Хеш тела + времени | RFC Message-ID уникален на стороне отправителя; проверка через `@unique` в БД — самый строгий и дешёвый способ. AC-024. |

---

## 10. Reusable код из коммита `73b0226`

Файлы для адаптации (не копировать 1-в-1):

| Файл из 73b0226 | Адаптация | Куда |
|---|---|---|
| `src/modules/tasks/public-id.ts` | Без изменений (генератор `TASK-XXXXX` base32 без 0/1/I/O). Алфавит: `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`. 5 символов = 32^5 = 33M, коллизия проверяется через UNIQUE и retry. | `src/modules/tasks/public-id.ts` |
| `src/modules/tasks/office-matcher.ts` | Адаптировать: вместо `Task.type` — теперь работает на `externalContact.officeNumber`. Логика поиска по `Office.number` + handling `OFFICE_AMBIGUOUS` остаётся. | `src/modules/tasks/office-matcher.ts` |
| `src/modules/tasks/mentions.ts` | Парсер `@username` → User[]. Адаптировать: возвращает `{ userIds, unknown }`, dispatcher отправляет `task.mention` event. | `src/modules/tasks/mentions.ts` |
| `bot/handlers/tasks-flow.ts` | Полная переработка: state machine `/issue` (5 шагов из PRD). Без ветвления по `type`. `source=TELEGRAM`, `reporterUserId` из `User.telegramId`. Если нет `telegramId` → deep-link к `/api/auth/telegram-link`. | `bot/handlers/issue-flow.ts` |

---

## 11. Структура файлов модуля (карта)

```
src/modules/tasks/
├── service.ts              CRUD задач, transitions, оркестрация event'ов
├── board-service.ts        boards, columns: create/update/delete/reorder, validation last-column / non-empty
├── assignees-service.ts    add/remove/role-change, demote-current logic
├── comments-service.ts     создание комментариев, mentions extract, attachments, visibleToReporter rules
├── events-service.ts       append-only TaskEvent + helpers для UI
├── subscriptions-service.ts watch/unwatch task/board/category
├── routing.ts              category keyword match → categoryId; defaultResponsibleUserId apply
├── public-id.ts            генератор TASK-XXXXX
├── office-matcher.ts       поиск Office по тексту, OFFICE_AMBIGUOUS
├── mentions.ts             @username parser
├── email-inbound.ts        IMAP poll, parse [TASK-XXXXX], create task/comment, idempotency
├── tg-flow.ts              state machine /issue, /mytasks, /settings
├── report-service.ts       публичная форма /report (auto-categorize + create)
├── track-service.ts        public lookup по trackingId, фильтр visibleToReporter
├── views-service.ts        SavedTaskView CRUD, лимит 10
├── access.ts               assertTaskAccess(userId, mode), RBAC хелперы
├── validation.ts           Zod схемы
├── types.ts                DTO
├── scheduler-hooks.ts      cron: due_soon (24h), reorder rebalance, IMAP poll trigger
└── __tests__/
    ├── service.test.ts
    ├── routing.test.ts
    ├── public-id.test.ts
    ├── office-matcher.test.ts
    ├── mentions.test.ts
    ├── access.test.ts
    └── report-service.test.ts

src/modules/notifications/
├── dispatcher.ts           NotificationDispatcher.dispatch(event)
├── channel-registry.ts     регистрация и получение каналов
├── outgoing-queue.ts       создание/обновление OutgoingNotification, retry
├── dedup.ts                sha256 hashing + lookup в окне 5 мин
├── quiet-hours.ts          вычисление scheduledFor по preferences
├── preferences-service.ts  CRUD NotificationEventPreference / Global
├── channels-service.ts     CRUD UserNotificationChannel + verify/confirm
├── legacy.ts               notify(userId, eventType, payload) shim для старых модулей
├── scheduler-hooks.ts      воркер: каждую минуту poll PENDING/DEFERRED → channel.send
├── channels/
│   ├── telegram.ts         TelegramChannel (Grammy)
│   ├── email.ts            EmailChannel (Yandex SMTP, nodemailer)
│   ├── whatsapp.ts         stub
│   ├── max.ts              stub
│   ├── imessage.ts         stub
│   ├── sms.ts              stub
│   └── push.ts             stub
├── types.ts                INotificationChannel, NotificationPayload, etc.
├── validation.ts           Zod
└── __tests__/
    ├── dispatcher.test.ts
    ├── dedup.test.ts
    ├── quiet-hours.test.ts
    ├── channel-registry.test.ts
    └── channels/{telegram,email}.test.ts
```

---

## 12. План реализации для Developer (8 шагов)

1. **Schema + миграция + seed.** Prisma-модели Section 2 → одна миграция → запустить `prisma migrate dev` локально → seed дефолтных board/columns/categories → smoke-тест в БД.
2. **Notifications refactor (channel-agnostic).** Создать `INotificationChannel`, `ChannelRegistry`, `TelegramChannel`, `EmailChannel`, stubs. Реализовать `NotificationDispatcher` + `OutgoingNotification` worker. Добавить `legacy.ts` shim. Прогнать существующие тесты gazebos/ps-park/cafe.
3. **Tasks core: CRUD + канбан API.** `service.ts`, `board-service.ts`, route handlers `/api/tasks`, `/api/tasks/boards`, `/api/tasks/:id/column`. RBAC через `assertTaskAccess`. Тесты на happy path + 4xx.
4. **Assignees + comments + events + mentions.** Все мутации генерируют `TaskEvent` и dispatch уведомлений по матрице PRD §6.2.
5. **Public /report + /track + office-matcher + auto-categorization.** Rate limit, OFFICE_AMBIGUOUS, email confirm. Адаптировать `office-matcher.ts` и `public-id.ts` из 73b0226.
6. **Telegram bot /issue + /mytasks + /settings.** State machine. Notification preferences UI в боте (упрощённый). 
7. **IMAP inbound email.** Feature flag `INBOUND_EMAIL_ENABLED`. Корреляция `[TASK-XXXXX]`. Идемпотентность через `emailMessageId UNIQUE`.
8. **Admin UI** (`/admin/tasks`, `/admin/tasks/[publicId]`, `/admin/tasks/boards`, `/admin/tasks/categories`, `/admin/notifications`, `/profile/notifications`). `@dnd-kit` уже в deps.

На каждом шаге: тесты в том же коммите, `npm test` зелёный, conventional commits, обновление CLAUDE.md в финальном коммите того же PR.

---

## 13. Security checklist (для Developer + Reviewer)

- [ ] Все мутации задач, комментариев, ассайни, колонок → `AuditLog`.
- [ ] Все новые endpoints: Zod валидация на входе, `apiResponse`/`apiError` на выходе.
- [ ] `POST /api/tasks/report` — без auth, rate-limited по IP (5/час), CAPTCHA — V2.
- [ ] `GET /api/tasks/track/:id` — только публичные комментарии (`visibleToReporter=true`), publicId неугадываем (32^5).
- [ ] `externalContact` в API-ответах: для аноним-track-страницы НЕ отдавать email/phone других репортёров.
- [ ] `OutgoingNotification.payload` не должен содержать пароли, токены — на уровне dispatcher шерится только title/body/actions.
- [ ] Verification codes — bcrypt, TTL 10 минут, 5 попыток (AC-057-style).
- [ ] IMAP credentials, SMTP credentials — только в env, не в коде, не в логах.
- [ ] Mentions (@username) не должны раскрывать существование пользователя для USER (отвечать «найдено N»).
- [ ] Прикрепляемые файлы (10 МБ) — валидация MIME, sanitize filename, отдельный bucket/folder, antivirus scan — V2 / отметить как known limitation.
- [ ] Drag-n-drop column endpoint защищён от race condition: `UPDATE … WHERE columnId=? AND sortOrder=?` оптимистичный лок, либо короткая транзакция.

---

## 14. Известные ограничения V1 (для PRD совместимости)

- Заглушки WhatsApp/MAX/iMessage/SMS — `isAvailable()===false`, попытка отправки даёт WARNING в SystemEvent.
- IMAP polling каждые 60 секунд — не realtime.
- Sortable канбан — фоновый rebalance Float-индексов раз в неделю.
- Saved views — личные, не shared (V2).
- Per-board / per-category preferences — V2.
- Виртуализация канбана для >1000 задач — V2.
- Antivirus сканирование вложений — V2.

---

**Готовность:** ADR закрыт, готов передан Developer. Все архитектурные решения обоснованы, схема БД полная, миграция плана прописана, RBAC матрица замкнута на endpoint'ах. Следующий шаг — Stage 3 (Senior Developer) реализует по плану §12.
