# Контекст pipeline: Rental Email Notifications

**RUN_ID:** `2026-04-21-rental-email-notifications`
**Дата старта:** 2026-04-21
**Модуль:** rental
**Инициатор:** Владелец

## Исходное ТЗ

Интегрировать систему email-рассылок в модуль **АРЕНДА**:

1. **Ручная отправка писем** арендаторам из интерфейса администратора.
2. **Автоматические напоминания об оплате ежемесячной аренды**:
   - За N дней до даты платежа (по умолчанию **5 дней**) — первое напоминание.
   - В день даты платежа, если платёж не поступил — второе напоминание.
   - Через **5 дней** после даты платежа, если платёж не поступил — **эскалация на Менеджера** (создаётся задача «дойти ногами до арендатора»).
3. **Редактор шаблонов** писем в админке (HTML/plain) с переменными-плейсхолдерами (`{{tenant}}`, `{{amount}}`, `{{dueDate}}` и т. п.).
4. **Настройки расписания** — пороги в днях редактируются через GUI, без изменения кода.
5. **Отправитель:** `buh@delovoy-park.ru` (в исходном ТЗ опечатка `deloovoy` — исправлено).

## Существующая инфраструктура (обнаружено в Stage 0)

- **SMTP-транспорт** — `src/modules/notifications/channels/email.ts` (nodemailer, Yandex SMTP, env `SMTP_USER`/`SMTP_PASS`/`SMTP_HOST`/`SMTP_FROM`).
  - `sendTransactionalEmail({ to, subject, html, text })` — готовая функция.
  - `emailAdapter` — канал для системы уведомлений.
- **Notifications module** — `src/modules/notifications/` с `events.ts`, `queue.ts`, `scheduler.ts`, `templates.ts`, `email-templates.ts`.
- **Rental module** — `src/modules/rental/` (service, types, validation, changelog).
- **RentalContract (Prisma)** — поля: `tenantId`, `officeId`, `startDate`, `endDate`, `monthlyRate`, `currency`, `deposit`, `contractNumber`, `status`, `notes`. **Нет** ни `paymentDate`, ни истории платежей, ни трекинга статуса оплаты месяца.
- **Tenant** — уже есть `email` + `emailsExtra` (Json) — каналы для рассылки.
- **AuditLog** и **SystemEvent** — доступны для логирования действий.

## Stage 1 — PO (завершено)

PRD создан: `docs/requirements/2026-04-21-rental-email-notifications-prd.md`

---

## PO — Ключевые решения

### Принятые решения

**1. Модель трекинга платежей: `RentalPayment` (полная, не `lastPaidUntil`)**
Выбрана полноценная модель с историей периодов. Поле `lastPaidUntil` — технический костыль, несовместимый с историей оплат, аудитом и будущей интеграцией с бухгалтерией. Architect может рассмотреть только хранилище, не логику.

**2. Эскалация: оба канала (вариант C) — `ManagerTask` + Telegram-алерт**
Только задача в интерфейсе недостаточна (менеджер может не зайти). Только Telegram-алерт недостаточен (нет истории, нет статуса «проработано»). Оба канала вместе закрывают проблему.

**3. Шаблоны в отдельной таблице `EmailTemplate`, не в файловой системе**
GUI-редактирование невозможно без хранения в БД. Architect решает, нужна ли миграция существующих шаблонов из `email-templates.ts` или хранятся параллельно.

**4. `EmailLog` как специализированная таблица, отдельно от `NotificationLog`**
`NotificationLog` — общесистемный, без полей `periodYear`/`periodMonth`/`tenantId` и типов EMAIL_LOG_TYPE. Для аудита rental-рассылок нужна собственная таблица.

**5. Настройки расписания: отдельная таблица `RentalNotificationSettings`**
Type-safe, валидируется на уровне Prisma. Architect может выбрать `Module.config` JSON как альтернативу, но при этом теряется типизация.

**6. Отправитель всегда `buh@delovoy-park.ru`**
Менеджер не может изменить From. Реализуется через env `SMTP_FROM` или принудительный override в rental-сервисе отправки.

### Ключевые AC (для QA-чеклиста)

- AC-3.4 / AC-4.4 / AC-5.6 — идемпотентность всех трёх этапов напоминания (один раз на период).
- AC-5.3 / AC-5.5 — экран задач менеджера с кнопками закрытия и автоматической проставкой `paidAt`.
- AC-6.4 — генерация `RentalPayment` при создании договора (на весь срок).
- AC-7.4 — валидация плейсхолдеров при сохранении шаблона.
- AC-3.6 / AC-4.3 — пропуск арендаторов с DRAFT / TERMINATED / EXPIRED договорами.
- AC-1.7 — отправитель всегда `buh@delovoy-park.ru`.

### Скоуп In / Out

**In scope (P0):**
- Ручная отправка (US-1)
- Все три этапа авторассылки (US-3, US-4, US-5)
- Трекинг платежей `RentalPayment` (US-6)
- Редактор шаблонов (US-7)
- Настройки расписания (US-8)

**In scope (P1):**
- Массовая рассылка по группе арендаторов (US-2)
- Экран истории отправок (US-9)

**Out of scope:**
- SMS, Telegram-диалог с арендатором
- Онлайн-оплата, PDF-счета, интеграция 1С
- Open rate трекинг, unsubscribe
- Индивидуальные даты платежа через UI

### Открытые вопросы для Architect

1. **Хранение настроек расписания**: отдельная таблица `RentalNotificationSettings` или `Module.config` JSON? Нужно решение с учётом типизации.
2. **Связь `EmailLog` с `NotificationLog`**: создаём новую таблицу или расширяем существующую `NotificationLog` новыми полями? Риск разбухания общей таблицы.
3. **Генерация `RentalPayment` при импорте данных** (`importFromJson`): нужно ли генерировать записи ретроспективно для существующих договоров? Если да — нужен скрипт миграции.
4. **Переменная `{{bankDetails}}`**: где хранятся реквизиты для оплаты — в `RentalNotificationSettings`, в `Module.config` или вводятся вручную в шаблоне?
5. **Время запуска планировщика (09:00 МСК)**: сейчас scheduler вызывается каждые 5 минут без привязки ко времени суток. Нужен ли cron-like scheduler для «утреннего» прогона, или проверять временной диапазон внутри функции?
6. **`SMTP_FROM` override**: сейчас `from` берётся из `process.env.SMTP_FROM || SMTP_USER`. Для rental нужен `buh@delovoy-park.ru` — это отдельный SMTP-аккаунт или только изменение поля From в заголовке письма?

---

## Stage 2 — Architect (завершено)

ADR создан: `docs/architecture/2026-04-21-rental-email-notifications-adr.md`

## Architect — Ключевые решения

### Ответы на открытые вопросы PO

1. **Настройки расписания** — отдельная таблица `RentalNotificationSettings` (singleton, `id="singleton"`). Причина: type-safety, audit trail через `updatedAt`/`updatedById`, нет разбухания `Module.config` JSON. Сюда же уехали `fromEmail`, `fromName`, `bankDetails`, `managerName`, `managerPhone`, Telegram-алерт настройки.
2. **`EmailLog`** — отдельная таблица от `NotificationLog`. Domain-специфичные поля (`contractId`, `paymentId`, `periodYear`, `periodMonth`, `templateKey`, `EmailLogType`), свой UI и фильтры. Без FK на Tenant/Contract — журнал переживает удаление связанных сущностей.
3. **Backfill платежей** — однократный скрипт `scripts/backfill-rental-payments.ts` для всех ACTIVE/EXPIRING контрактов. ВСЕ прошедшие периоды создаются с `paidAt=null` — менеджер обязан вручную разметить. До разметки `autoSendEnabled=false`. Флаг завершения — `Module(rental).config.paymentsBackfillCompletedAt`.
4. **`{{bankDetails}}`** — поле `bankDetails` в `RentalNotificationSettings`, редактируется через `PATCH /api/rental/notification-settings`. Подставляется как переменная, не хардкодится в шаблон.
5. **09:00 МСК** — отдельный cron-endpoint `GET /api/cron/rental-payment-reminders` с `CRON_SECRET`, запускается crontab VPS раз в сутки: `0 6 * * *` (UTC). Не встраиваем в существующий `processScheduledNotifications()` — консистентно с `/api/cron/process-recurring` и `/api/cron/inventory`.
6. **SMTP From** — добавляем опциональное поле `from` в `TransactionalEmailParams`. Значение из `settings.fromEmail` (default `buh@delovoy-park.ru`). Yandex SMTP должен разрешить алиас; fallback — отдельный SMTP-аккаунт `SMTP_FROM_RENTAL`.

### Ключевые архитектурные решения

| Решение | Выбор |
|---|---|
| Настройки | Таблица `RentalNotificationSettings` (singleton) |
| Журнал | Отдельный `EmailLog` |
| Идемпотентность | Флаги-даты на `RentalPayment` (атомарный UPDATE), не `EmailLog`-поиск |
| Scheduler | Отдельный cron-endpoint + `CRON_SECRET`, crontab VPS `0 6 * * *` UTC |
| Шаблонизатор | Собственный regex `{{var}}`, без Handlebars |
| Telegram-алерт | Общий helper `src/lib/telegram-alert.ts` (выделен из `inventory/alerts.ts`), не через `enqueueNotification` |
| From | Override поля `from` в `TransactionalEmailParams` |
| HTML-санитизация | `isomorphic-dompurify` в preview-эндпоинте (единственная новая npm-зависимость) |
| Каскад | `RentalPayment onDelete: Cascade`, `EmailLog` без FK |

### Новые Prisma-модели (5)

- **`RentalPayment`** — `contractId`, `periodYear`, `periodMonth`, `dueDate`, `amount`, `paidAt?`, `firstReminderSentAt?`, `dueDateReminderSentAt?`, `escalatedAt?`. `@@unique([contractId, periodYear, periodMonth])`.
- **`EmailTemplate`** — `key @unique`, `subject`, `bodyHtml`, `bodyText?`, `variables: Json`, `isSystem`, `isActive`. Системные ключи: `rental.payment_reminder_pre`, `rental.payment_reminder_due`, `rental.manual`.
- **`EmailLog`** — `type` (MANUAL/PAYMENT_PRE_REMINDER/PAYMENT_DUE_REMINDER/ESCALATION_INTERNAL), `to: String[]`, `subject`, `bodyHtml?`, `tenantId?`, `contractId?`, `paymentId?`, `sentById?`, `status`, `error?`. Без FK.
- **`RentalNotificationSettings`** (singleton) — `preReminderDays`, `escalationDaysAfter`, `autoSendEnabled`, `fromEmail`, `fromName`, `bankDetails`, `managerName`, `managerPhone`, `escalationTelegramEnabled`, `escalationTelegramChatId`.
- **`ManagerTask`** — `type: OVERDUE_PAYMENT`, `status: OPEN/RESOLVED/DEFERRED`, `contractId?`, `paymentId?`, `periodYear?`, `periodMonth?`, `assignedToId?`, `resolution`, `deferUntil?`. `@@unique([type, contractId, periodYear, periodMonth])`.

### Новые endpoints (13 + cron)

**Templates (SUPERADMIN W, MANAGER R):** `GET/POST /api/rental/email-templates`, `GET/PATCH/DELETE /api/rental/email-templates/[key]`, `POST /api/rental/email-templates/[key]/preview`.
**Settings (SUPERADMIN):** `GET/PATCH /api/rental/notification-settings`.
**Manual send (SUPERADMIN + MANAGER rental):** `POST /api/rental/send-email`, `POST /api/rental/send-email/bulk`.
**Payments (SUPERADMIN + MANAGER rental):** `GET /api/rental/contracts/[id]/payments`, `PATCH /api/rental/payments/[id]`, `GET /api/rental/payments/upcoming`.
**Tasks (SUPERADMIN + MANAGER rental):** `GET /api/rental/tasks`, `PATCH /api/rental/tasks/[id]`.
**Log (SUPERADMIN + MANAGER rental):** `GET /api/rental/email-log`.
**Cron:** `GET /api/cron/rental-payment-reminders` (Bearer `CRON_SECRET`).

### Scheduler-стратегия

`runRentalPaymentReminders()` раз в сутки запускает три функции:
- `sendPreReminders(N)` — платежи с `dueDate BETWEEN today AND today+N`, `firstReminderSentAt IS NULL`.
- `sendDueReminders()` — платежи с `dueDate = today`, `dueDateReminderSentAt IS NULL`, `paidAt IS NULL`.
- `escalateOverdue(M)` — платежи с `dueDate <= today-M`, `escalatedAt IS NULL`, контракт ACTIVE/EXPIRING → создать `ManagerTask` + Telegram-алерт + `SystemEvent WARNING`.

Все фильтруют контракты только ACTIVE/EXPIRING (AC-3.6). Флаги ставятся после успешной отправки хотя бы на один адрес.

### Главные риски

1. Yandex SMTP может отклонить From=buh@ без alias'а → план B отдельный SMTP.
2. Backfill без разметки платежей → спам арендаторам → гейт `autoSendEnabled=false` + UI-баннер.
3. Гонки cron → атомарный UPDATE-WHERE-NULL + уникальный индекс ManagerTask.
4. XSS через HTML в manual send → DOMPurify в preview, доверие к SUPERADMIN/MANAGER.

### Передача Developer

Чеклист из 12 шагов в ADR. Порядок: Prisma миграция → сиды → lib/telegram-alert → template-engine → payments → notifications → scheduler → validation → API endpoints → UI → backfill script → crontab VPS.
