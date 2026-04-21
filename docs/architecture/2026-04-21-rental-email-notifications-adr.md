# ADR: Email-уведомления и рассылки в модуле Аренда

## Статус
Предложено

## Контекст

Модулю Аренда нужна система email-коммуникаций: ручная отправка писем арендаторам, трёхступенчатые автоматические напоминания об оплате (T-N, T=0, T+M) с эскалацией на менеджера, редактор шаблонов в GUI и настраиваемое расписание.

Полный PRD: `docs/requirements/2026-04-21-rental-email-notifications-prd.md`. Открытые вопросы PO: `docs/context/2026-04-21-rental-email-notifications-context.md` (секция «PO — Ключевые решения»).

Существующая инфраструктура, на которую опираемся (НЕ переписываем):
- `sendTransactionalEmail({ to, subject, html, text })` — готовый SMTP-транспорт через Yandex (`src/modules/notifications/channels/email.ts`).
- `NotificationLog` — общий лог уведомлений (используется для booking/order, не подходит по схеме для rental-журнала писем).
- `processScheduledNotifications()` — текущий scheduler (`src/modules/notifications/scheduler.ts`), вызывается из `GET /api/cron/notifications?token=<CRON_SECRET>`. Уже содержит `processContractExpiryAlerts()`.
- `CRON_SECRET` — стандарт проекта для cron-эндпоинтов (`/api/cron/process-recurring`, `/api/cron/notifications`).
- `AuditLog`, `SystemEvent`, `RentalChangeLog` — готовые журналы.
- `sendTelegramAlert` — реализован локально в `src/modules/inventory/alerts.ts`; нужен общий helper в `src/lib/telegram-alert.ts`.

Ключевые требования PRD:
- AC-1.7: отправитель всегда `buh@delovoy-park.ru`, менеджер не меняет From.
- AC-3.4 / AC-4.4 / AC-5.6: идемпотентность всех трёх этапов (один раз за период).
- AC-6.4: при создании договора автоматически генерируются `RentalPayment` на весь срок.
- AC-7.4: валидация плейсхолдеров при сохранении шаблона.
- AC-3.6 / AC-4.3: DRAFT/TERMINATED/EXPIRED пропускаются авторассылкой.

---

## Варианты

### 1. Хранение настроек расписания: `Module.config` JSON vs отдельная таблица `RentalNotificationSettings`

- **A. `Module.config` JSON** — минимум миграций, единая точка для всех модулей. Минусы: нет type-safety на уровне Prisma, валидация только в коде, сложнее делать индексы/uniq-констрейнты, нельзя подписаться на updatedAt/updatedBy через обычные Prisma-inclusions. У `rental` уже будет пухлый JSON.
- **B. Отдельная таблица `RentalNotificationSettings` (singleton)** — type-safe, мигрируется вместе со схемой, есть `updatedAt`/`updatedById`. Минусы: +1 модель в схеме.

**Выбрано: B.** Фича критична, настройки редактируются часто (пороги дней, включение/выключение), нужен явный audit trail (`updatedById`). Накладные расходы одной строки в БД ничтожны. Это соответствует решению PO #5.

### 2. Журнал писем: расширить `NotificationLog` vs новая таблица `EmailLog`

- **A. Расширить `NotificationLog`** добавив поля `contractId`, `tenantId`, `periodYear`, `periodMonth`, `templateKey`. Минусы: смешиваем транзакционные и бизнес-журналы, расширяем схему «общей» таблицы ради одного модуля, новые индексы нужны только rental — общая таблица разбухает, enum-поле `eventType` остаётся строковым, появляются нерелевантные столбцы для других модулей.
- **B. Отдельная таблица `EmailLog` для модуля rental.** Плюсы: изолированная схема с нужными полями и индексами, чётко разделённая ответственность (транзакционные нотификации vs журнал email-коммуникаций с арендаторами), свой enum `EmailLogType`, свой UI-экран. Минусы: частичная дубликация кода логирования.

**Выбрано: B.** Решение PO #4 явно требует отдельную таблицу. Принцип Domain Modules — каждый модуль владеет своим ведомым журналом.

### 3. Трекинг платежей: `RentalPayment` vs поле `lastPaidUntil`

Решение зафиксировано PO (#1): только `RentalPayment`. Architect не меняет.

### 4. Scheduler: встроить в существующий `processScheduledNotifications()` vs отдельный cron-endpoint

Три интервала авторассылок работают «раз в сутки в 09:00 МСК», текущий `processScheduledNotifications()` дёргается каждые 5 минут. Варианты:

- **A. Встроить в `processScheduledNotifications()`** с внутренней проверкой «запускалось ли сегодня в окне 09:00-09:05». Плюсы: одна точка входа cron. Минусы: вложенная проверка расписания внутри «реактивного» планировщика путает ответственность.
- **B. Отдельный cron-endpoint `GET /api/cron/rental-payment-reminders`** с авторизацией по `CRON_SECRET`, вызываемый раз в сутки (системный crontab VPS или GitHub Actions workflow). Плюсы: чистое разделение, легко тестировать, расписание управляется инфраструктурой, не кодом. Консистентно с `/api/cron/process-recurring` (там же паттерн раз-в-сутки).

**Выбрано: B.** Консистентно с существующим паттерном «один cron = один endpoint + CRON_SECRET». В `DEPLOYMENT.md` добавляется запись в crontab VPS: `0 6 * * * curl -H "Authorization: Bearer $CRON_SECRET" https://delovoy-park.ru/api/cron/rental-payment-reminders` (09:00 МСК = 06:00 UTC).

### 5. Идемпотентность: проверять по `EmailLog` vs флаги на `RentalPayment`

- **A. Запрос в `EmailLog`** по `(contractId, periodYear, periodMonth, templateKey, status=SENT)` — плюс гибкость. Минус: гонки (два параллельных cron-запуска), расширение условий сложнее.
- **B. Булевые/датные флаги на `RentalPayment`**: `firstReminderSentAt`, `dueDateReminderSentAt`, `escalatedAt`. Плюсы: атомарный UPDATE `WHERE firstReminderSentAt IS NULL` в одной транзакции, невозможен race, проще фильтровать `findMany`.

**Выбрано: B.** Уже зафиксировано в PRD (раздел «Модель данных»). Флаги + `EmailLog` для аудита — лучший гибрид.

### 6. Шаблонизатор: Handlebars vs собственный regex

- **A. Handlebars / Mustache** — новая зависимость, overkill для плоского `{{var}}` без циклов и условий.
- **B. Собственный `renderTemplate(tpl, vars)` на regex `/{{(\w+)}}/g`** — 10 строк кода, zero-dependency.

**Выбрано: B.** Rental-шаблоны — это плоский набор переменных. Нет веткований, циклов, партиалов. Введение Handlebars — нарушение правила «не переусложняй».

### 7. Отправитель `buh@delovoy-park.ru`: новый SMTP-аккаунт vs override `from`

- **A. Отдельный SMTP-аккаунт** (buh@) с своими credentials. Плюсы: письма уходят с того же сервера. Минусы: второй набор env-переменных (`SMTP_RENTAL_USER`/`PASS`), усложнение конфигурации.
- **B. Override только поля From** при существующем SMTP-аккаунте. Yandex SMTP разрешает отправку from любого алиаса того же домена, если он зарегистрирован как alias в Yandex Connect.

**Выбрано: B с опцией на A.** Добавляем опциональный параметр `from` в `TransactionalEmailParams`. Для rental используем `process.env.SMTP_FROM_RENTAL || "buh@delovoy-park.ru"`. Если Yandex отклонит (нет алиаса) — DevOps регистрирует алиас; если и это невозможно — переходим на A (отдельный SMTP), но это откладывается до реальной проблемы.

### 8. Telegram-алерт менеджеру при T+5

- **A. Через `enqueueNotification`** с новым event-типом (требует расширять `events.ts`, `templates.ts`, нагрузка на весь notification pipeline ради одного кейса).
- **B. Прямой вызов общего `sendTelegramAlert(chatId, message)`** из `src/lib/telegram-alert.ts` (выделенный из `inventory/alerts.ts`).

**Выбрано: B.** Эскалация — внутренний админ-алерт, не клиентская нотификация. Не нужен routing, preferences, channel resolution. Достаточно вызвать Telegram Bot API. Выделяем `sendTelegramAlert` в общий helper для переиспользования.

---

## Решение

Строим фичу на 5 новых Prisma-моделях (`RentalPayment`, `EmailTemplate`, `EmailLog`, `RentalNotificationSettings`, `ManagerTask`) и трёх новых enum'ах. Cron-endpoint `/api/cron/rental-payment-reminders` раз в сутки запускает три функции (T-N, T=0, T+M) с идемпотентностью через флаги на `RentalPayment`. Ручная отправка — прямая синхронная вызов `sendTransactionalEmail` из rental-сервиса с записью в `EmailLog` и `AuditLog`. Шаблонизатор — собственный regex `{{var}}` с валидацией допустимых переменных. UI: 5 новых страниц + модалка, все под `/admin/rental/...`.

---

## Схема данных (Prisma)

### Новые enum'ы

```prisma
enum EmailLogType {
  MANUAL                  // ручная отправка менеджером
  PAYMENT_PRE_REMINDER    // T-N
  PAYMENT_DUE_REMINDER    // T=0
  ESCALATION_INTERNAL     // T+M, только в журнале (письмо арендатору не уходит, но в EmailLog — запись для аудита эскалации)
}

enum EmailLogStatus {
  SENT
  FAILED
}

enum ManagerTaskType {
  OVERDUE_PAYMENT
}

enum TaskStatus {
  OPEN
  RESOLVED
  DEFERRED
}
```

### RentalPayment (AC-6.*, идемпотентность AC-3.4/4.4/5.6)

```prisma
model RentalPayment {
  id                     String   @id @default(cuid())
  contractId             String
  contract               RentalContract @relation(fields: [contractId], references: [id], onDelete: Cascade)
  periodYear             Int                    // YYYY
  periodMonth            Int                    // 1..12
  dueDate                DateTime               // ожидаемая дата оплаты
  amount                 Decimal                // сумма за период (может отличаться от monthlyRate при корректировке)
  currency               String   @default("RUB")
  paidAt                 DateTime?              // факт оплаты; null → не оплачен
  markedPaidById         String?                // userId менеджера, отметившего платёж
  firstReminderSentAt    DateTime?              // T-N отправлено
  dueDateReminderSentAt  DateTime?              // T=0 отправлено
  escalatedAt            DateTime?              // T+M задача создана и алерт отправлен
  amountAdjustmentReason String?  @db.Text      // причина, если amount != monthlyRate
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@unique([contractId, periodYear, periodMonth])
  @@index([dueDate, paidAt])
  @@index([contractId, paidAt])
}
```

`onDelete: Cascade` — при удалении контракта удаляются и его платежи. Семантика соответствует текущему отсутствию soft delete у `RentalContract` (есть только статусы).

В `RentalContract` добавляется reverse-relation:
```prisma
payments RentalPayment[]
```

### EmailTemplate (AC-7.*)

```prisma
model EmailTemplate {
  id          String   @id @default(cuid())
  moduleSlug  String   @default("rental")
  key         String   @unique                 // "rental.payment_reminder_pre", ...
  name        String                            // отображаемое имя
  subject     String                            // поддерживает {{var}}
  bodyHtml    String   @db.Text                // HTML с {{var}}
  bodyText    String?  @db.Text                // plain-text fallback, опционально
  variables   Json                              // string[] — разрешённые плейсхолдеры, напр. ["tenantName","amount","dueDate"]
  isActive    Boolean  @default(true)
  isSystem    Boolean  @default(false)         // системные (нельзя удалить, можно редактировать)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([moduleSlug])
}
```

**Системные ключи, предзагружаемые сидом:**
- `rental.payment_reminder_pre` — T-N (isSystem=true)
- `rental.payment_reminder_due` — T=0 (isSystem=true)
- `rental.manual` — пустая заготовка для ручных писем (isSystem=true)

T+5 шаблона нет: третий шаг — внутренняя эскалация, письма арендатору не уходят (AC-5.7).

### EmailLog (AC-9.*)

```prisma
model EmailLog {
  id          String          @id @default(cuid())
  moduleSlug  String          @default("rental")
  type        EmailLogType
  templateKey String?                           // null для свободных писем
  to          String[]                          // один или несколько адресов
  subject     String
  bodyHtml    String?         @db.Text          // snapshot отправленного HTML (для аудита)
  tenantId    String?
  contractId  String?
  paymentId   String?                           // если связан с RentalPayment
  periodYear  Int?
  periodMonth Int?
  sentById    String?                           // userId отправителя; null для cron
  status      EmailLogStatus
  error       String?         @db.Text
  sentAt      DateTime        @default(now())

  @@index([tenantId, sentAt])
  @@index([contractId, sentAt])
  @@index([status, sentAt])
  @@index([type, sentAt])
}
```

Не добавляем FK к Tenant/Contract/User чтобы избежать каскадных проблем при soft-delete арендатора и сохранить журнал после удаления. Денормализованный `to` (`String[]`) отражает, что одно письмо могло идти на несколько адресов.

### RentalNotificationSettings (AC-8.*)

```prisma
model RentalNotificationSettings {
  id                  String   @id @default("singleton")
  preReminderDays     Int      @default(5)     // T-N (1..30)
  escalationDaysAfter Int      @default(5)     // T+M (1..30)
  autoSendEnabled     Boolean  @default(true)
  fromEmail           String   @default("buh@delovoy-park.ru")
  fromName            String   @default("Бухгалтерия Делового Парка")
  bankDetails         String?  @db.Text        // реквизиты, подставляются как {{bankDetails}}
  managerName         String?                   // подпись в письме {{managerName}}
  managerPhone        String?                   // {{managerPhone}}
  escalationTelegramEnabled Boolean @default(true)
  escalationTelegramChatId  String?            // если пусто — берётся из Module(rental).config или env
  updatedAt           DateTime @updatedAt
  updatedById         String?
}
```

Singleton: id заранее задан `"singleton"`. Сид создаёт запись при первой миграции. Все чтения/записи идут через `prisma.rentalNotificationSettings.upsert({ where: { id: "singleton" }, ... })`.

### ManagerTask (AC-5.*)

```prisma
model ManagerTask {
  id           String          @id @default(cuid())
  moduleSlug   String          @default("rental")
  type         ManagerTaskType
  status       TaskStatus      @default(OPEN)
  title        String
  description  String?         @db.Text
  contractId   String?
  tenantId     String?
  paymentId    String?                         // для OVERDUE_PAYMENT
  periodYear   Int?
  periodMonth  Int?
  assignedToId String?                         // userId менеджера; null = любой MANAGER(rental)
  createdById  String?                         // null для авто-созданных
  dueDate      DateTime?
  resolvedAt   DateTime?
  resolvedById String?
  resolution   String?                         // "PAYMENT_RECEIVED" | "TENANT_DEFERRED" | "CONTRACT_TERMINATING" | custom
  resolutionNote String?       @db.Text
  deferUntil   DateTime?                       // если DEFERRED
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  @@unique([type, contractId, periodYear, periodMonth])  // одна OVERDUE_PAYMENT-задача на период договора
  @@index([status, assignedToId])
  @@index([moduleSlug, status])
}
```

`@@unique([type, contractId, periodYear, periodMonth])` гарантирует идемпотентность AC-5.6. Поля `contractId`/`periodYear`/`periodMonth` могут быть null для задач другого типа в будущем — Postgres уникальный индекс с NULL-ами не считает коллизией.

---

## Миграция данных

### Prisma-миграция
`prisma/migrations/20260421_rental_email_notifications/migration.sql` — создаёт все 5 моделей и 4 enum'а.

### Сиды (запускаются в конце миграции)

1. **Системные `EmailTemplate`** — `prisma/migrations/20260421_rental_email_notifications/seed.sql` (или отдельно в `scripts/seed-email-templates.ts`, запускается из `package.json` скрипта `db:seed-rental`):
   - `rental.payment_reminder_pre` с subject «Напоминание об оплате аренды — до {{dueDate}}», HTML из шаблонов в `src/modules/rental/email-templates/`.
   - `rental.payment_reminder_due` — «Сегодня срок оплаты аренды».
   - `rental.manual` — пустая заготовка («Здравствуйте, {{contactName}}!»).

2. **`RentalNotificationSettings`** — singleton-запись с дефолтами (`preReminderDays=5`, `escalationDaysAfter=5`, `autoSendEnabled=true`, `fromEmail="buh@delovoy-park.ru"`).

### Backfill существующих контрактов

Скрипт: `scripts/backfill-rental-payments.ts` (запускается вручную один раз после миграции). Логика:

```
для каждого RentalContract со status IN (DRAFT, ACTIVE, EXPIRING):
  для каждого месяца m от startDate.month до endDate.month:
    dueDate = первое число месяца m
    upsert RentalPayment {
      contractId, periodYear, periodMonth,
      dueDate, amount = contract.monthlyRate,
      paidAt: dueDate < сегодня ? null : null   // все помечаем unknown
    } on conflict DO NOTHING
```

**Стратегия для прошедших периодов:** ВСЕ прошедшие платежи создаются с `paidAt = null`. Менеджер вручную через UI проставит `paidAt` для уже оплаченных (иначе авторассылка начнёт слать «вы не заплатили за январь» всем подряд). Перед первым запуском cron автоматической рассылки **обязательно** провести сессию «разметки»: менеджер проходится по всем prior платежам и ставит `paidAt`. На время разметки `autoSendEnabled=false` (выставляется в сиде).

**После разметки** SUPERADMIN переключает `autoSendEnabled=true` в UI настроек. Первый cron-прогон ровно в следующие сутки.

### Flag в Module.config (мониторинг миграции)

В `Module.config` модуля `rental` добавляется служебный флаг `paymentsBackfillCompletedAt: DateTime?`. Устанавливается скриптом backfill после успешного выполнения. UI показывает баннер «Завершите разметку платежей» до установки этого флага.

---

## Интеграция с существующим rental-сервисом

### `createContract` (AC-6.4)

После `prisma.rentalContract.create(...)` — синхронный вызов `generatePaymentsForContract(contract)` из нового `src/modules/rental/payments.ts`:

```
generatePaymentsForContract(contract):
  payments = []
  cursor = first day of startDate month
  while cursor < endDate:
    payments.push({ contractId, periodYear, periodMonth, dueDate: cursor, amount: contract.monthlyRate })
    cursor = cursor + 1 month
  prisma.rentalPayment.createMany({ data: payments, skipDuplicates: true })
```

### `updateContract` с изменением `monthlyRate` / `endDate`

```
regeneratePendingPayments(contract):
  // Пересчитать только будущие периоды, ещё не оплаченные
  prisma.rentalPayment.deleteMany({
    where: { contractId, paidAt: null, dueDate: { gte: today } }
  });
  // Сгенерировать заново от сегодняшнего месяца до нового endDate с новым amount
  ... (аналогично createContract)
```

Платежи с `paidAt != null` или `dueDate < today` остаются в истории неизменными.

### `terminateContract` (переход на TERMINATED)

Будущие PENDING-платежи НЕ удаляются, а помечаются: остаются в `RentalPayment`, но `autoRemindersSkipped` теперь логически обеспечивается фильтром в scheduler'е (`contract.status IN (ACTIVE, EXPIRING)`). Это даёт историчность и позволяет в UI показать «недополученная выручка из-за расторжения». `ManagerTask` с типом OVERDUE_PAYMENT, уже открытые на этот контракт, автоматически закрываются со статусом RESOLVED и resolution=`CONTRACT_TERMINATING`.

### `renewContract` (AC-6.5)

После продления — `generatePaymentsForContract(contract)` вызывается повторно, `skipDuplicates: true` не создаст коллизий для старых месяцев, добавит только новые.

---

## API-контракты

Все ответы через `apiResponse()` / `apiError()`. Валидация входа через Zod. Формат ошибок — стандартный.

### Шаблоны писем (SUPERADMIN только)

#### `GET /api/rental/email-templates`
- **RBAC**: SUPERADMIN (SUPERADMIN-only через `hasRole(user, "SUPERADMIN")`). MANAGER получает 403.
- **Query**: `?includeInactive=true` (опц.)
- **Response**: `{ templates: EmailTemplate[] }`

#### `GET /api/rental/email-templates/[key]`
- **RBAC**: SUPERADMIN + MANAGER (rental) — просмотр разрешён и менеджеру (AC-7.7: «может просматривать»).
- **Response**: `{ template: EmailTemplate }`

#### `POST /api/rental/email-templates` — создать пользовательский шаблон
- **RBAC**: SUPERADMIN.
- **Zod**:
  ```ts
  createTemplateSchema = z.object({
    key: z.string().regex(/^rental\.[a-z0-9_]+$/).refine(not system key),
    name: z.string().min(1).max(200),
    subject: z.string().min(1).max(500),
    bodyHtml: z.string().min(1).max(50000),
    bodyText: z.string().max(50000).optional(),
    variables: z.array(z.enum(ALLOWED_VARIABLES)).default([]),
    isActive: z.boolean().default(true),
  });
  ```
- **Валидация плейсхолдеров**: `extractPlaceholders(subject + bodyHtml)` ⊆ `ALLOWED_VARIABLES`. При нарушении → `apiError("INVALID_PLACEHOLDER", "Неизвестная переменная: {{foo}}", 422)`.
- **isSystem всегда false** при создании через API.
- **AuditLog**: `action: "email_template.created"`.

#### `PATCH /api/rental/email-templates/[key]`
- **RBAC**: SUPERADMIN.
- **Zod**: subset предыдущего, поле `key` неизменяемо. Системные шаблоны редактируются (но не переименовываются, не меняют `isSystem`).
- **AuditLog**: `action: "email_template.updated"`, metadata: `{ key, before, after }`.

#### `DELETE /api/rental/email-templates/[key]`
- **RBAC**: SUPERADMIN.
- **Проверка**: `if (template.isSystem) return apiError("SYSTEM_TEMPLATE_PROTECTED", "Системный шаблон нельзя удалить", 403);`
- **AuditLog**: `action: "email_template.deleted"`.

#### `POST /api/rental/email-templates/[key]/preview`
- **RBAC**: SUPERADMIN + MANAGER (rental).
- **Body**: `{ sampleVars?: Record<string,string> }` — если пусто, подставляются демо-значения.
- **Response**: `{ subject, html, text, missingVars: string[] }` — `missingVars` перечисляет переменные, для которых нет значения.
- **Rate limit**: 30/min на пользователя.

### Настройки (SUPERADMIN)

#### `GET /api/rental/notification-settings`
- **RBAC**: SUPERADMIN.
- **Response**: `{ settings: RentalNotificationSettings }` — если записи нет, возвращает дефолты (не создаёт автоматически — создаёт сид).

#### `PATCH /api/rental/notification-settings`
- **RBAC**: SUPERADMIN.
- **Zod**:
  ```ts
  updateSettingsSchema = z.object({
    preReminderDays: z.number().int().min(1).max(30).optional(),
    escalationDaysAfter: z.number().int().min(1).max(30).optional(),
    autoSendEnabled: z.boolean().optional(),
    fromEmail: z.string().email().optional(),
    fromName: z.string().min(1).max(200).optional(),
    bankDetails: z.string().max(5000).nullable().optional(),
    managerName: z.string().max(200).nullable().optional(),
    managerPhone: z.string().max(50).nullable().optional(),
    escalationTelegramEnabled: z.boolean().optional(),
    escalationTelegramChatId: z.string().max(100).nullable().optional(),
  });
  ```
- **AuditLog**: `action: "rental_notification_settings.updated"`, metadata: `{ before, after }`.

### Ручная отправка (SUPERADMIN + MANAGER rental)

#### `POST /api/rental/send-email`
- **RBAC**: SUPERADMIN или MANAGER с `hasAdminSectionAccess(userId, "rental")`. Единый guard: `requireAdminSection(session, "rental")`.
- **Rate limit**: 20/min на пользователя.
- **Zod**:
  ```ts
  sendEmailSchema = z.object({
    tenantId: z.string().cuid().optional(),
    contractId: z.string().cuid().optional(),
    to: z.array(z.string().email()).min(1).max(10),  // явно выбранные адреса (подмножество email+emailsExtra)
    templateKey: z.string().optional(),               // если задан — берём шаблон
    customSubject: z.string().min(1).max(500).optional(),
    customBodyHtml: z.string().min(1).max(100000).optional(),
    variables: z.record(z.string(), z.string()).optional(),  // override конкретных значений
  }).refine(
    (d) => (d.templateKey) || (d.customSubject && d.customBodyHtml),
    "Нужен либо templateKey, либо customSubject+customBodyHtml"
  ).refine(
    (d) => d.tenantId || d.contractId,
    "tenantId или contractId обязателен"
  );
  ```
- **Логика**:
  1. Резолвим tenant/contract → набор разрешённых email (`tenant.email` + `tenant.emailsExtra`).
  2. Фильтруем `to` так, чтобы подмножество. Лишние → 422.
  3. Рендерим шаблон/кастомный HTML с переменными из `buildVariablesFor(tenant, contract, payment?, settings)` + override.
  4. Санитизация HTML — исходный HTML уже из доверенного источника (SUPERADMIN-шаблон или менеджер видит только превью), поэтому `DOMPurify` применяется только в `POST /.../preview` на серверной стороне через `isomorphic-dompurify` (единственная новая npm-зависимость; обоснование: защита от случайно вставленного `<script>` в preview).
  5. Последовательно `sendTransactionalEmail({ to, from, subject, html, text })` для каждого адреса.
  6. Записи в `EmailLog` (по одной на получателя, тип `MANUAL`).
  7. `AuditLog`: `action: "email.sent"`, `entity: "Tenant"|"RentalContract"`.
- **Response**: `{ sent: EmailLog[], failed: EmailLog[] }`.
- **AC-1.4**: если у арендатора ни `email`, ни `emailsExtra` — 422 `NO_RECIPIENT`.

#### `POST /api/rental/send-email/bulk` (P1, US-2)
- **RBAC**: SUPERADMIN + MANAGER rental.
- **Rate limit**: 5/min.
- **Zod**: `{ tenantIds: string[] (max 100), templateKey | customSubject+customBodyHtml, variables? }`.
- **Поведение**: цикл по tenantIds, для каждого вызывает внутреннюю функцию `sendEmailToTenant`. Арендаторы без email пропускаются (попадают в `skipped[]`).
- **Response**: `{ sent, failed, skipped }`.

### Платежи (SUPERADMIN + MANAGER rental)

#### `GET /api/rental/contracts/[id]/payments`
- **RBAC**: SUPERADMIN + MANAGER rental.
- **Query**: `?year=2026&status=paid|unpaid|all` (по умолчанию all).
- **Response**: `{ payments: RentalPayment[] }` отсортирован по `dueDate DESC`.

#### `PATCH /api/rental/payments/[id]`
- **RBAC**: SUPERADMIN + MANAGER rental.
- **Zod**:
  ```ts
  updatePaymentSchema = z.object({
    paidAt: z.string().datetime().nullable().optional(),   // отметить оплаченным или снять отметку
    amount: z.number().positive().optional(),              // корректировка суммы
    amountAdjustmentReason: z.string().min(3).max(500).optional(),
  }).refine(
    (d) => !d.amount || d.amountAdjustmentReason,
    "При изменении суммы обязательна причина"
  );
  ```
- **Логика**: запись в `RentalChangeLog` (entity=RentalPayment, field=amount/paidAt), `AuditLog`.

### Задачи менеджера (SUPERADMIN + MANAGER rental)

#### `GET /api/rental/tasks`
- **RBAC**: SUPERADMIN + MANAGER rental.
- **Query**: `?status=OPEN|RESOLVED|DEFERRED&assignedToId=me|any&page=1&limit=50`.
- **Фильтрация**: MANAGER видит все задачи модуля rental (нет деления по менеджерам — только один менеджер rental). SUPERADMIN видит все.
- **Response**: `{ tasks: ManagerTask[], total }` с eager-load `contract.tenant`, `payment`.

#### `PATCH /api/rental/tasks/[id]`
- **RBAC**: SUPERADMIN + MANAGER rental.
- **Zod**:
  ```ts
  updateTaskSchema = z.object({
    status: z.enum(["RESOLVED", "DEFERRED"]),
    resolution: z.enum(["PAYMENT_RECEIVED","TENANT_DEFERRED","CONTRACT_TERMINATING","OTHER"]).optional(),
    resolutionNote: z.string().max(1000).optional(),
    deferUntil: z.string().datetime().optional(),   // обязательно при DEFERRED
    markPaymentPaid: z.boolean().default(false),    // AC-5.5
  });
  ```
- **AC-5.5**: если `status=RESOLVED` и `markPaymentPaid=true` и у задачи есть `paymentId` → `payment.paidAt = now()` в той же транзакции.
- **AuditLog**: `action: "manager_task.resolved"`.

### Журнал (SUPERADMIN + MANAGER rental — AC-9.4)

#### `GET /api/rental/email-log`
- **RBAC**: SUPERADMIN + MANAGER rental.
- **Query**: `?tenantId=&contractId=&type=&status=&from=&to=&page=1&limit=50`.
- **Response**: `{ logs: EmailLog[], total }`. Пагинация 50/стр.

### Cron-endpoint (без user-сессии)

#### `GET /api/cron/rental-payment-reminders`
- **Auth**: `Authorization: Bearer ${CRON_SECRET}` или query `?token=$CRON_SECRET`.
- **Частота**: раз в сутки (crontab VPS: `0 6 * * *` = 09:00 МСК).
- **Логика**:
  ```
  settings = loadSettings()
  if (!settings.autoSendEnabled) return { skipped: "auto-send disabled" }
  results = await Promise.allSettled([
    sendPreReminders(settings.preReminderDays),
    sendDueReminders(),
    escalateOverdue(settings.escalationDaysAfter),
  ])
  return apiResponse({ results })
  ```
- **Защита от SSRF**: CRON_SECRET проверяется через `timingSafeEqual` (не `===`).

### Виджет (GET для дашборда)

#### `GET /api/rental/payments/upcoming`
- **RBAC**: SUPERADMIN + MANAGER rental.
- **Query**: `?withinDays=7`.
- **Response**: `{ payments: (RentalPayment & { contract.tenant, contract.office })[] }` — неоплаченные с `dueDate <= today + withinDays`.

---

## Scheduler: детальная логика

Файл: `src/modules/rental/scheduler.ts`. Экспортирует `runRentalPaymentReminders()` и три внутренних функции.

### `sendPreReminders(preReminderDays)`

```
today = startOfDay(now)
target = addDays(today, preReminderDays)
payments = findMany({
  where: {
    paidAt: null,
    firstReminderSentAt: null,
    dueDate: { gte: today, lte: endOfDay(target) },   // окно суток, чтобы пропустить не более одной недели выходных
    contract: { status: { in: ["ACTIVE", "EXPIRING"] } }
  },
  include: { contract: { include: { tenant, office } } }
})
for each payment:
  if (!tenant.email && !tenant.emailsExtra) {
    logSystemEvent(WARNING, `Tenant ${tenant.id} без email`);
    continue;
  }
  template = loadTemplate("rental.payment_reminder_pre")
  if (!template.isActive) {
    logSystemEvent(WARNING, `Шаблон rental.payment_reminder_pre деактивирован`);
    break;
  }
  vars = buildVariables(payment, contract, tenant, office, settings)
  { subject, html, text } = renderTemplate(template, vars)
  for each addr in [tenant.email, ...emailsExtra]:
    result = await sendTransactionalEmail({ to: addr, from: settings.fromEmail, subject, html, text })
    createEmailLog({ ..., type: PAYMENT_PRE_REMINDER, paymentId: payment.id, status: result.success ? SENT : FAILED, error })
  // Мягкая семантика: ставим флаг, даже если часть адресов FAILED — не будем спамить повторно.
  // Если ВСЕ адреса FAILED → оставляем firstReminderSentAt=null, чтобы попробовать ещё раз при следующем запуске cron.
  if (anySuccess) {
    updatePayment({ firstReminderSentAt: now })
  }
```

### `sendDueReminders()`

Окно `dueDate BETWEEN startOfDay(today) AND endOfDay(today)`. Фильтр `dueDateReminderSentAt: null, paidAt: null`. Остальное идентично.

### `escalateOverdue(escalationDaysAfter)`

```
threshold = subDays(today, escalationDaysAfter)
payments = findMany({
  where: {
    paidAt: null,
    escalatedAt: null,
    dueDate: { lte: threshold },
    contract: { status: { in: ["ACTIVE", "EXPIRING"] } }   // AC-3.6: пропускаем TERMINATED/EXPIRED
  },
  include: { contract: { tenant, office } }
})
for each payment:
  // 1. Создать задачу (упадёт на @@unique если уже есть)
  try {
    task = prisma.managerTask.create({
      data: {
        type: OVERDUE_PAYMENT,
        contractId, tenantId, paymentId, periodYear, periodMonth,
        title: `Просрочка: ${tenant.companyName}, офис ${office.number}, ${daysOverdue} дн.`,
        description: ...,
      }
    })
  } catch (P2002) { continue; /* задача уже есть */ }

  // 2. Telegram-алерт
  if (settings.escalationTelegramEnabled) {
    await sendTelegramAlert(escalationChatId, formatEscalationMessage(task, payment, contract, tenant, office))
  }

  // 3. SystemEvent WARNING (AC-5.2)
  logSystemEvent(WARNING, "rental.payment.overdue", { contractId, paymentId, daysOverdue })

  // 4. EmailLog запись ESCALATION_INTERNAL (для журнала, не реальное письмо арендатору)
  createEmailLog({ type: ESCALATION_INTERNAL, paymentId, status: SENT, ... })

  // 5. Флаг
  updatePayment({ escalatedAt: now })
```

**AC-5.7:** После escalatedAt авторассылки больше не идут — условия в `sendPreReminders` и `sendDueReminders` уже их пропустят (для dueDate в прошлом в pre-reminder окне ничего не попадёт; due-reminder смотрит только «сегодня»).

---

## Шаблонизатор

Файл: `src/modules/rental/template-engine.ts`.

```ts
export const ALLOWED_VARIABLES = [
  "tenantName", "contactName", "contractNumber",
  "officeNumber", "building", "floor",
  "amount", "currency", "dueDate", "periodMonth", "periodYear",
  "daysOverdue", "bankDetails", "managerName", "managerPhone",
  "parkAddress",
] as const;

export function extractPlaceholders(tpl: string): string[] {
  const re = /\{\{(\w+)\}\}/g;
  const found = new Set<string>();
  for (const m of tpl.matchAll(re)) found.add(m[1]);
  return [...found];
}

export function validateTemplate(tpl: string): { ok: true } | { ok: false; invalid: string[] } {
  const used = extractPlaceholders(tpl);
  const invalid = used.filter((v) => !ALLOWED_VARIABLES.includes(v as any));
  return invalid.length ? { ok: false, invalid } : { ok: true };
}

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export function buildVariables(
  payment: RentalPayment | null,
  contract: RentalContract & { tenant: Tenant; office: Office },
  settings: RentalNotificationSettings
): Record<string, string> {
  const ru = { month: ["январь",...,"декабрь"] };
  const daysOverdue = payment ? Math.max(0, daysBetween(new Date(), payment.dueDate)) : 0;
  return {
    tenantName: contract.tenant.companyName,
    contactName: contract.tenant.contactName ?? contract.tenant.companyName,
    contractNumber: contract.contractNumber ?? "б/н",
    officeNumber: contract.office.number,
    building: String(contract.office.building),
    floor: String(contract.office.floor),
    amount: formatMoney(payment?.amount ?? contract.monthlyRate),
    currency: payment?.currency ?? contract.currency,
    dueDate: payment ? formatDateRu(payment.dueDate) : "",
    periodMonth: payment ? ru.month[payment.periodMonth - 1] : "",
    periodYear: payment ? String(payment.periodYear) : "",
    daysOverdue: String(daysOverdue),
    bankDetails: settings.bankDetails ?? "",
    managerName: settings.managerName ?? "",
    managerPhone: settings.managerPhone ?? "",
    parkAddress: "Селятино, Московская область, Бизнес-парк «Деловой»",
  };
}
```

---

## RBAC-матрица

| Endpoint / действие | SUPERADMIN | MANAGER (rental) | MANAGER (другой) | USER |
|---|---|---|---|---|
| `GET /api/rental/email-templates` | R | R (только просмотр) | — | — |
| `POST/PATCH/DELETE /api/rental/email-templates` | W | — | — | — |
| `POST /api/rental/email-templates/[key]/preview` | R | R | — | — |
| `GET /api/rental/notification-settings` | R | — | — | — |
| `PATCH /api/rental/notification-settings` | W | — | — | — |
| `POST /api/rental/send-email` | W | W | — | — |
| `POST /api/rental/send-email/bulk` | W | W | — | — |
| `GET /api/rental/contracts/[id]/payments` | R | R | — | — |
| `PATCH /api/rental/payments/[id]` | W | W | — | — |
| `GET /api/rental/tasks` | R | R | — | — |
| `PATCH /api/rental/tasks/[id]` | W | W | — | — |
| `GET /api/rental/email-log` | R | R | — | — |
| `GET /api/rental/payments/upcoming` | R | R | — | — |
| `GET /api/cron/rental-payment-reminders` | — | — | — | — (CRON_SECRET) |

Единая проверка в route handlers:
```ts
const session = await auth();
const denied = await requireAdminSection(session, "rental");
if (denied) return denied;
// Для SUPERADMIN-only эндпоинтов дополнительно:
if (session!.user.role !== "SUPERADMIN") return apiForbidden();
```

### Rate limiting

| Endpoint | Лимит |
|---|---|
| `POST /api/rental/send-email` | 20 / мин / user |
| `POST /api/rental/send-email/bulk` | 5 / мин / user |
| `POST /api/rental/email-templates/[key]/preview` | 30 / мин / user |
| `PATCH /api/rental/email-templates/[key]` | 10 / мин / user |
| `PATCH /api/rental/notification-settings` | 10 / мин / user |
| `GET /api/cron/rental-payment-reminders` | — (идемпотентен сам по себе, защищён secret'ом) |
| Остальные `GET` | 120 / мин / user (стандарт) |

---

## Переменные шаблонов — источники данных

| Переменная | Источник | Формат |
|---|---|---|
| `{{tenantName}}` | `tenant.companyName` | строка |
| `{{contactName}}` | `tenant.contactName ?? tenant.companyName` | строка |
| `{{contractNumber}}` | `contract.contractNumber ?? "б/н"` | строка |
| `{{officeNumber}}` | `office.number` | строка |
| `{{building}}`, `{{floor}}` | `office.building`, `office.floor` | целое |
| `{{amount}}` | `payment.amount ?? contract.monthlyRate` | «45 000,00 ₽» |
| `{{currency}}` | `payment.currency ?? contract.currency` | RUB/USD/EUR |
| `{{dueDate}}` | `payment.dueDate` | DD.MM.YYYY |
| `{{periodMonth}}` | `payment.periodMonth` | «январь»…«декабрь» (ru-RU) |
| `{{periodYear}}` | `payment.periodYear` | YYYY |
| `{{daysOverdue}}` | `max(0, today - payment.dueDate)` | целое |
| `{{bankDetails}}` | `settings.bankDetails` | многострочный текст |
| `{{managerName}}` / `{{managerPhone}}` | `settings.managerName/Phone` | строка |
| `{{parkAddress}}` | константа «Селятино, МО, Деловой Парк» | строка |

---

## UI-страницы

| Путь | Роль | Назначение |
|---|---|---|
| `/admin/rental/email-templates` | SUPERADMIN | Список шаблонов + кнопка «Создать». MANAGER получает readonly-список через `hasAdminSectionAccess("rental")`. |
| `/admin/rental/email-templates/[key]` | SUPERADMIN | Редактор: textarea для HTML, сбоку панель доступных переменных, кнопка «Предпросмотр», кнопка «Деактивировать». |
| `/admin/rental/notification-settings` | SUPERADMIN | Форма: `preReminderDays`, `escalationDaysAfter`, toggle `autoSendEnabled`, `fromEmail`, bankDetails (textarea), managerName/Phone, Telegram-настройки. |
| `/admin/rental/tasks` | SUPERADMIN + MANAGER rental | Список задач с фильтрами (OPEN/RESOLVED/DEFERRED). Для OVERDUE_PAYMENT — inline-кнопки «Оплата поступила» / «Отложить на 3 дня» / «Закрыть с причиной». |
| `/admin/rental/email-log` | SUPERADMIN + MANAGER rental | Таблица с фильтрами по tenant/contract/type/status/date. Пагинация 50/стр. |
| `/admin/rental/contracts/[id]` — вкладка «Платежи» | SUPERADMIN + MANAGER rental | Таблица `RentalPayment` по договору, inline «Отметить оплаченным» (с date-picker). Корректировка суммы — модалка с обязательным полем reason. |
| `/admin/rental/tenants/[id]` — вкладка «Письма» | SUPERADMIN + MANAGER rental | Локальный срез `EmailLog` по tenantId. |
| Модалка «Отправить письмо» | SUPERADMIN + MANAGER rental | Доступна на страницах Tenant / Contract. Поля: получатели (чекбоксы из `email`+`emailsExtra`), шаблон (select) или «Без шаблона», Subject, Body (textarea + preview toggle), переменные подставляются живым превью. |
| Виджет «Ожидают оплаты» на `/admin/rental` | SUPERADMIN + MANAGER rental | Карточка со списком ближайших 7 дней: tenant, office, amount, dueDate, кнопка «Перейти к договору». |

**HTML-редактор:** обычный `<textarea>` + режим preview через `<iframe srcDoc={sanitizedHtml} />`. WYSIWYG не делаем в MVP. Санитизация в preview-режиме: `isomorphic-dompurify` (единственная новая npm-зависимость).

---

## Технические решения (кратко)

1. **Шаблонизатор**: собственный regex `{{var}}`, не Handlebars.
2. **Идемпотентность**: флаги-даты на `RentalPayment`, атомарный update.
3. **Scheduler**: отдельный cron-endpoint + CRON_SECRET + crontab VPS (`0 6 * * *` UTC).
4. **Journal**: отдельная `EmailLog`, не расширение `NotificationLog`.
5. **Settings**: отдельная таблица-singleton, не `Module.config`.
6. **Отправитель**: override `from` в `TransactionalEmailParams` (добавить поле), значение из `settings.fromEmail`.
7. **Telegram-алерт**: выделить `sendTelegramAlert(chatId, message)` в `src/lib/telegram-alert.ts` из существующего `inventory/alerts.ts`.
8. **HTML-санитизация**: `isomorphic-dompurify` только в preview-эндпоинте и при рендере в iframe (редактор). Новая npm-зависимость — обоснована защитой от XSS в SUPERADMIN-UI (повышенные привилегии → более важна защита).
9. **Каскадное удаление платежей**: `onDelete: Cascade` на `RentalPayment`, но `EmailLog` без FK — журнал переживает удаление контракта.
10. **Backfill**: однократный скрипт `scripts/backfill-rental-payments.ts`, флаг `paymentsBackfillCompletedAt` в `Module(rental).config`, до завершения — `autoSendEnabled=false`.

---

## Последствия

### Изменения схемы БД
- 5 новых моделей: `RentalPayment`, `EmailTemplate`, `EmailLog`, `RentalNotificationSettings`, `ManagerTask`.
- 4 новых enum: `EmailLogType`, `EmailLogStatus`, `ManagerTaskType`, `TaskStatus`.
- 1 новая relation в `RentalContract.payments`.
- Миграция: `20260421000001_rental_email_notifications`.

### Новые зависимости npm
- `isomorphic-dompurify` (XSS-санитизация preview/iframe). Лицензия LGPL-2.1 или Apache-2.0, совместимо.

### Изменения существующих модулей
- `src/modules/notifications/channels/email.ts`: добавить опциональное поле `from` в `TransactionalEmailParams`.
- `src/modules/rental/service.ts`: в `createContract`, `updateContract` (при изменении monthlyRate/endDate), `renewContract`, `terminateContract` — вызовы `generatePaymentsForContract` / `regeneratePendingPayments`.
- `src/lib/telegram-alert.ts` (новый): извлечённый общий helper.
- `src/modules/inventory/alerts.ts`: заменить локальный `sendTelegramAlert` на импорт из `lib/telegram-alert.ts`.

### Новые env-переменные (опционально)
- `SMTP_FROM_RENTAL` — если нужен отдельный from только для rental-писем (иначе берётся из `RentalNotificationSettings.fromEmail`, а env — fallback).

### DevOps: crontab VPS
```
# /etc/cron.d/delovoy-park
0 6 * * * www-data curl -sS -H "Authorization: Bearer $CRON_SECRET" https://delovoy-park.ru/api/cron/rental-payment-reminders >/dev/null 2>&1
```
(09:00 МСК = 06:00 UTC). Вносится в `DEPLOYMENT.md`.

### Security
- Все новые endpoints: RBAC + Zod + rate limit.
- Cron: `timingSafeEqual(token, CRON_SECRET)`.
- HTML preview санитизуется через DOMPurify.
- Переменные шаблонов — whitelist, неизвестные запрещены на уровне валидации.
- `RentalChangeLog` фиксирует изменение amount/paidAt.
- `AuditLog` — на все мутации (`email.sent`, `email_template.*`, `rental_notification_settings.updated`, `manager_task.resolved`).
- Публичный SMTP: `from` принимает только валидный email (Zod `.email()`), subject/html max-length ограничены.

### Обратная совместимость
- Existing `RentalContract` CRUD не ломается — только дополняется генерацией `RentalPayment`.
- `NotificationLog` не трогаем.
- Сид системных шаблонов идемпотентен (`upsert by key`).

---

## Риски

1. **Yandex SMTP отклонит from=buh@delovoy-park.ru**, если этот адрес не зарегистрирован как alias в Yandex Connect. Митигация: DevOps регистрирует alias перед деплоем; если невозможно — откатываемся на отдельный SMTP-аккаунт (план B в варианте #7).
2. **Backfill платежей без разметки → спам арендаторам**. Митигация: `autoSendEnabled=false` по умолчанию в сиде, баннер в UI до завершения разметки, `paymentsBackfillCompletedAt` флаг в Module.config.
3. **Cron пропущен (сервер down)**. Митигация: в `sendPreReminders` используется окно «от today до today+preReminderDays», т.е. пропуск одного дня покрывается следующим запуском (поймаем dueDate в окне N-1 дней). Для `sendDueReminders` — окно строго «сегодня»: при пропуске один день dueDate будет подхвачен эскалацией через M дней, арендатор получит второе напоминание не T=0, а из задачи менеджера. Принимаемый риск.
4. **Гонки при параллельных cron-вызовах**. Митигация: атомарность через `UPDATE WHERE firstReminderSentAt IS NULL`; уникальный индекс `ManagerTask`.
5. **Рост `EmailLog`**. Оценка: 30 арендаторов × 3 письма/мес = 90 записей/мес = ~1100/год. Не проблема. Архивирование — не нужно в MVP.
6. **Плоский шаблонизатор не поддерживает условия**. Если в будущем понадобится «если daysOverdue > 10 — говорить жёстче» — нужно будет мигрировать на Handlebars. Принимаемый долг.
7. **XSS через кастомный HTML в send-email**. Митигация: ручные письма пишет только SUPERADMIN/MANAGER (доверенные). Дополнительно — DOMPurify при preview. Исходящий HTML в Yandex SMTP также санитизуется перед отправкой.
8. **Отсутствие email у арендатора → warning в SystemEvent каждые сутки**. Митигация: добавить dedup ключ в Redis (как в `inventory/alerts.ts`) на 7 дней.
9. **Дата платежа — первое число месяца**, но у некоторых арендаторов по договору — другое число. Для MVP dueDate всегда = 1-е число; индивидуальные даты платежа — вне скоупа PRD (явно). При необходимости — поле `paymentDayOfMonth` на `RentalContract` в будущей итерации.

---

## Тесты (vitest, без реальной БД)

Обязательное покрытие (`CLAUDE.md` — тесты вместе с кодом):

1. **`rental/__tests__/payments.test.ts`**
   - `generatePaymentsForContract` создаёт N записей на срок (N = число месяцев между startDate и endDate).
   - `regeneratePendingPayments` удаляет только PENDING+future, не трогает PAID/прошлые.
   - При terminateContract OPEN-задачи становятся RESOLVED с `CONTRACT_TERMINATING`.

2. **`rental/__tests__/scheduler.test.ts`**
   - `sendPreReminders` шлёт 1 письмо на платёж с dueDate через N дней и не шлёт повторно при втором вызове.
   - `sendDueReminders` не шлёт, если `paidAt != null`.
   - `escalateOverdue` создаёт `ManagerTask` и вызывает `sendTelegramAlert`; повторный вызов не создаёт дубль (мокаем P2002).
   - Все функции пропускают контракты со статусом TERMINATED/EXPIRED.
   - При `settings.autoSendEnabled=false` ни одна из трёх функций не шлёт (runner-тест на `runRentalPaymentReminders`).
   - При деактивированном шаблоне — WARNING в SystemEvent, писем нет.

3. **`rental/__tests__/template-engine.test.ts`**
   - `renderTemplate` подставляет известные переменные, отсутствующие → пустая строка.
   - `validateTemplate` принимает только whitelist-переменные.
   - `buildVariables` форматирует дату DD.MM.YYYY и месяц на русском.

4. **`rental/__tests__/validation.test.ts`**
   - `sendEmailSchema`: отклоняет без templateKey и без customSubject+customBody.
   - `sendEmailSchema`: отклоняет email, не входящий в `tenant.email + emailsExtra`.
   - `updateSettingsSchema`: preReminderDays 0 → fail, 31 → fail, 5 → ok.
   - `createTemplateSchema`: плейсхолдер `{{foo}}` не из whitelist → fail.

5. **API route handlers** (happy + error path на каждый):
   - `POST /api/rental/send-email` — happy (отправка), no-recipient (NO_RECIPIENT), invalid-email-in-to (422).
   - `PATCH /api/rental/email-templates/[key]` — happy, system-protected-rename (FORBIDDEN), invalid-placeholder.
   - `DELETE /api/rental/email-templates/[key]` — happy (user), forbidden (system).
   - `PATCH /api/rental/payments/[id]` — happy (markPaid), amount-without-reason (422).
   - `PATCH /api/rental/tasks/[id]` — happy (markPaymentPaid=true → payment.paidAt установлен).
   - `GET /api/cron/rental-payment-reminders` — happy, wrong-token (401).

6. **`lib/__tests__/telegram-alert.test.ts`** — существующий функционал перенесён, тесты переписаны под новый путь.

Моки: `vi.mock('@/lib/db')`, `vi.mock('@/modules/notifications/channels/email', () => ({ sendTransactionalEmail: vi.fn() }))`, `vi.mock('@/lib/telegram-alert')`.

---

## Чеклист для Developer (пошагово)

1. **Миграция БД**
   - Отредактировать `prisma/schema.prisma`: добавить 5 моделей + 4 enum + relation на `RentalContract.payments`.
   - `npx prisma migrate dev --name rental_email_notifications` — создаст `prisma/migrations/20260421XXXX_rental_email_notifications/migration.sql`.
   - `npx prisma generate`.

2. **Сиды**
   - `scripts/seed-email-templates.ts` — upsert трёх системных шаблонов (`rental.payment_reminder_pre`, `rental.payment_reminder_due`, `rental.manual`) с HTML-версткой в стиле `email-templates.ts` (использовать тот же `emailLayout`).
   - Сид для `RentalNotificationSettings` singleton (`id="singleton"`, дефолты, `autoSendEnabled=false` до backfill).
   - Добавить в `package.json`: `"db:seed-rental": "tsx scripts/seed-email-templates.ts"`.

3. **Общие lib**
   - `src/lib/telegram-alert.ts` — извлечь `sendTelegramAlert(chatId, message, botToken?)` из `inventory/alerts.ts`, сделать параметризуемым. Обновить импорт в `inventory/alerts.ts`.
   - Добавить `from?: string` в `TransactionalEmailParams` (`src/modules/notifications/channels/email.ts`).

4. **Шаблонизатор**
   - `src/modules/rental/template-engine.ts` — `ALLOWED_VARIABLES`, `extractPlaceholders`, `validateTemplate`, `renderTemplate`, `buildVariables`.
   - Тесты: `src/modules/rental/__tests__/template-engine.test.ts`.

5. **Payments**
   - `src/modules/rental/payments.ts` — `generatePaymentsForContract`, `regeneratePendingPayments`, `markPaid`, `adjustAmount`.
   - Интеграция в `rental/service.ts`: `createContract`, `updateContract`, `renewContract`, `terminateContract` (+ авто-resolve `ManagerTask`).
   - Тесты: `src/modules/rental/__tests__/payments.test.ts`.

6. **Notifications (rental)**
   - `src/modules/rental/notifications.ts` — `sendManualEmail(params)`, `sendBulkEmails(params)`, `logEmail(...)`.
   - `src/modules/rental/scheduler.ts` — `runRentalPaymentReminders()`, `sendPreReminders`, `sendDueReminders`, `escalateOverdue`.
   - Тесты: `src/modules/rental/__tests__/scheduler.test.ts`.

7. **Validation**
   - `src/modules/rental/validation.ts` — Zod-схемы: `createTemplateSchema`, `updateTemplateSchema`, `updateSettingsSchema`, `sendEmailSchema`, `bulkSendSchema`, `updatePaymentSchema`, `updateTaskSchema`.
   - Тесты: `src/modules/rental/__tests__/validation.test.ts`.

8. **API endpoints**
   - `src/app/api/rental/email-templates/route.ts` (GET list, POST create).
   - `src/app/api/rental/email-templates/[key]/route.ts` (GET, PATCH, DELETE).
   - `src/app/api/rental/email-templates/[key]/preview/route.ts` (POST).
   - `src/app/api/rental/notification-settings/route.ts` (GET, PATCH).
   - `src/app/api/rental/send-email/route.ts` (POST).
   - `src/app/api/rental/send-email/bulk/route.ts` (POST).
   - `src/app/api/rental/contracts/[id]/payments/route.ts` (GET).
   - `src/app/api/rental/payments/[id]/route.ts` (PATCH).
   - `src/app/api/rental/payments/upcoming/route.ts` (GET).
   - `src/app/api/rental/tasks/route.ts` (GET).
   - `src/app/api/rental/tasks/[id]/route.ts` (PATCH).
   - `src/app/api/rental/email-log/route.ts` (GET).
   - `src/app/api/cron/rental-payment-reminders/route.ts` (GET).
   - На каждый — happy + error path в `__tests__`.

9. **UI**
   - `src/app/admin/rental/email-templates/page.tsx` — список.
   - `src/app/admin/rental/email-templates/[key]/page.tsx` — редактор + preview iframe.
   - `src/app/admin/rental/notification-settings/page.tsx` — форма.
   - `src/app/admin/rental/tasks/page.tsx` — список задач + inline actions.
   - `src/app/admin/rental/email-log/page.tsx` — таблица с фильтрами.
   - Вкладка «Платежи» в `src/app/admin/rental/contracts/[id]/page.tsx`.
   - Вкладка «Письма» в `src/app/admin/rental/tenants/[id]/page.tsx`.
   - Модалка `src/components/admin/rental/send-email-modal.tsx`.
   - Виджет `src/components/admin/rental/upcoming-payments-widget.tsx` на `/admin/rental/page.tsx`.

10. **Backfill**
    - `scripts/backfill-rental-payments.ts` — пройти все ACTIVE/EXPIRING контракты, создать `RentalPayment` на все периоды, обновить `Module(rental).config.paymentsBackfillCompletedAt`.
    - Запуск: `npx tsx scripts/backfill-rental-payments.ts` (однократно, после миграции).

11. **DevOps**
    - Добавить в `DEPLOYMENT.md` раздел «Rental payment reminders cron»: запись в crontab VPS `0 6 * * * curl -H "Authorization: Bearer $CRON_SECRET" https://delovoy-park.ru/api/cron/rental-payment-reminders`.
    - Env-переменные (если нужно): `SMTP_FROM_RENTAL`, `RENTAL_ESCALATION_CHAT_ID`.

12. **Запуск в прод**
    - Деплой миграции → деплой кода → запуск сидов → запуск backfill → разметка менеджером → SUPERADMIN включает `autoSendEnabled=true`.

---

## Связанные документы

- PRD: `docs/requirements/2026-04-21-rental-email-notifications-prd.md`
- Контекст: `docs/context/2026-04-21-rental-email-notifications-context.md`
- Предыдущий ADR по cron-паттерну: `docs/architecture/2026-04-18-cost-tracker-management-accounting-adr.md`
