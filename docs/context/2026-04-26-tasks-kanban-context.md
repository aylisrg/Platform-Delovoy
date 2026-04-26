# Context Log — 2026-04-26-tasks-kanban

**Фича:** «Задачи Делового» — единый канбан для всего парка (внутренние задачи + жалобы арендаторов в одной доске)
**Ветка:** `claude/explore-task-module-M0CDO`
**RUN_ID:** `2026-04-26-tasks-kanban`
**Старт:** 2026-04-26
**Координатор:** Claude Code (skill `feature`)

---

## Input от пользователя (ключевое)

1. **Объединение** — внутренний трекер и жалобы арендаторов это **один канбан**. Никакого `Task.type` дискриминатора. Разница только в `source` и наборе участников.
2. **Канбан-функциональность как у Bitrix24/Jira/Linear** — настраиваемые колонки (а не enum в коде), WIP-лимиты, swimlanes, фильтры, drag-n-drop, метки, кастомные поля.
3. **Гибкое назначение** — `RESPONSIBLE` (один) + `COLLABORATOR` (N) + `WATCHER` (M). Каждая роль получает разный набор уведомлений. Маршрутизация по категории, fallback «дежурный», эскалация по SLA (proback в V1).
4. **Channel-agnostic notifications** — добавить новый мессенджер (WhatsApp, MAX, iMessage, SMS) = реализовать один интерфейс `NotificationChannel`. Никаких правок в `NotificationDispatcher` или модуле tasks.
5. **Per-user preferences** — основной/резервный канал, quiet hours, типы событий, на которые юзер подписан.

## Контекст: предыдущая попытка

PR #178 (`73b0226 feat(tasks)!: v2.0`) — реализовал tasks с `type: INTERNAL | ISSUE`. Откачен в PR #181 из-за scope creep (модуль не был в реестре CLAUDE.md). Используем как референс реализации (office-matcher, public-id, mentions, tg-flow), НЕ восстанавливаем 1-в-1.

## Архитектурные решения (заданы пользователем)

- `Task` без `type` — только `source` (MANUAL/TELEGRAM/EMAIL/WEB/API)
- `TaskBoard` + `TaskColumn` — настраиваемые доски/колонки
- `TaskAssignee` — many-to-many `(taskId, userId, role: RESPONSIBLE|COLLABORATOR|WATCHER)`
- `NotificationChannel`, `NotificationPreference`, `OutgoingNotification` — отдельные сущности
- `NotificationDispatcher` + `ChannelRegistry` + интерфейс `NotificationChannel` — channel-agnostic архитектура
- Idempotency dedup по `(userId, eventType, entityId, hashOfPayload)` за 5 минут
- Quiet hours → статус `DEFERRED`

## Scope guard

Модуль `tasks` сейчас **отсутствует** в "Реальном списке модулей" CLAUDE.md. Этот pipeline должен:
- В Stage 1 (PRD) — обосновать включение в Phase 5.x
- В Stage 3 (Developer) — обновить CLAUDE.md в том же PR

## Артефакты

| Стадия | Файл |
|--------|------|
| Context | `docs/context/2026-04-26-tasks-kanban-context.md` (этот файл) |
| PRD | `docs/requirements/2026-04-26-tasks-kanban-prd.md` |
| ADR | `docs/architecture/2026-04-26-tasks-kanban-adr.md` |
| Review | `docs/qa-reports/2026-04-26-tasks-kanban-review.md` |
| QA Report | `docs/qa-reports/2026-04-26-tasks-kanban-qa-report.md` |

---

## PO — Ключевые решения

**Дата:** 2026-04-26

**Must для V1 (без этого модуль не запускается):**
- Настраиваемые колонки через БД (TaskBoard/TaskColumn) — не enum в коде. Это фундамент всего.
- Публичная форма /report с rate limiting, OFFICE_AMBIGUOUS и trackingId — главный канал жалоб арендаторов.
- Множественные участники через TaskAssignee (RESPONSIBLE / COLLABORATOR / WATCHER) с матрицей уведомлений.
- Channel-agnostic NotificationDispatcher с рабочими каналами Telegram + Email — архитектурный контракт, не опциональная деталь.
- Timeline TaskEvent и страница /track для анонимов — без них репортёр слеп.
- AuditLog на все мутации — требование безопасности.

**Критические AC для Architect:**
- AC-005 (publicId TASK-XXXXX, base32 без 0/1/I/O) — алгоритм генерации важен для корреляции email.
- AC-011 (OFFICE_AMBIGUOUS) — отдельный API-статус 409, не просто ошибка валидации.
- AC-024 (emailMessageId UNIQUE) — идемпотентность inbound email через constraint в БД, не прикладной дедуп.
- AC-036 (optimistic update drag-and-drop) — требует отдельного API PATCH /api/tasks/:id/column.
- AC-059 (quiet hours + DEFERRED) — OutgoingNotification.status=DEFERRED, нужен воркер с cron для отправки отложенных.

**Явно отложено в V2:**
- SLA-эскалация (автоматическая передача просроченных задач).
- WhatsApp/MAX/SMS как рабочие каналы (заглушки должны быть, но isAvailable=false).
- Per-board и per-category настройки уведомлений.
- Кастомные поля задач, подзадачи, спринты.
- Общие (расшариваемые) сохранённые виды.

**Важно знать Architect:**
- Рефакторинг `notifications` обязан сохранить обратную совместимость — все существующие модули (кафе, беседки, PS Park) должны продолжать работать через новый NotificationDispatcher без изменений в их коде.
- Модуль `tasks` не должен появляться в `src/modules/` до обновления CLAUDE.md в том же PR — scope guard rule.

## Architect — Ключевые решения

**Дата:** 2026-04-26
**ADR:** `docs/architecture/2026-04-26-tasks-kanban-adr.md`

**Критические технологические выборы:**
- Один `Task` без `type`, `TaskAssignee` m2m с `TaskAssigneeRole`, `TaskBoard`/`TaskColumn` как первоклассные сущности БД (не enum). `publicId TASK-XXXXX` через 32-символьный base32 без `0/1/I/O`, 5 знаков, UNIQUE + retry на коллизию.
- `Task.sortOrder` — Float (фракционный); rebalance worker раз в неделю. Lex-fractional indexing отложен в V2.
- `TaskComment.emailMessageId @unique` — идемпотентность IMAP **на уровне БД constraint**, не в приложении.
- Введён **новый** enum `NotificationChannelKind` (TELEGRAM/EMAIL/WHATSAPP/MAX/IMESSAGE/SMS/PUSH/VK), новые модели `UserNotificationChannel`, `NotificationEventPreference`, `NotificationGlobalPreference`, `OutgoingNotification`. Старые `NotificationPreference`/`NotificationLog` **остаются** для обратной совместимости — миграция данных через отдельный скрипт, не в DDL.
- Channel-agnostic: `INotificationChannel` (3 метода) + `ChannelRegistry`. Stub-каналы (`WhatsApp/Max/iMessage/SMS/Push`) присутствуют с `isAvailable()===false` — Dispatcher не падает, если в БД проставлен ещё неготовый канал.
- `OutgoingNotification` — это **очередь со статусами** (PENDING/DEFERRED/SENT/FAILED/SKIPPED), не лог. Воркер cron каждую минуту тянет PENDING/DEFERRED. Dedup через `dedupKey=sha256(userId|eventType|entityId|payloadHash)` в окне 5 минут.
- Quiet hours / DND вычисляются перед `INSERT` — `scheduledFor=конец окна` + `status=DEFERRED`.
- Legacy shim `notifications/legacy.ts` экспортирует `notify(userId, eventType, payload)` — старые модули (кафе/беседки/ps-park) **не правятся**.

**Риски, на которые Developer обязан обратить внимание:**
- При сохранении legacy `NotificationPreference`/`NotificationLog` параллельно с новой схемой — следить, чтобы новые мутации шли только через `NotificationDispatcher`. Иначе — двойные записи и расхождение каналов.
- `POST /api/tasks/report` без auth: rate limit 5/час/IP — обязателен **до** валидации, иначе можно DoS на Zod.
- `OFFICE_AMBIGUOUS` — это **409**, не 400, и не блок ошибок Zod. Отдельный код.
- Drag-n-drop column endpoint в условиях гонок — короткая транзакция или оптимистический лок по `(columnId, sortOrder)`.
- Mentions API не должен раскрывать существование USER аккаунтов для anonymous (V2-вектор атаки).
- IMAP-воркер должен идемпотентно обрабатывать повторные доставки (`emailMessageId UNIQUE` + try/catch на UNIQUE violation = no-op).
- Stub-каналы должны логировать WARNING в `SystemEvent`, чтобы не молчать при реальной потребности отправки.
- Seed `tasks` модуля + дефолтная доска `general` + 9 категорий + 6 колонок — обязателен в `prisma/seed.ts`, иначе модуль нерабочий «из коробки».
- CLAUDE.md обновляется **в том же PR** что и код (scope guard) — `tasks` в реестр + Phase 5.4 в roadmap.

## Developer — Решения и отступления от ADR
<!-- заполняется в Stage 3 -->

## Reviewer — Вердикт и итерации
<!-- заполняется в Stage 4 -->

## QA — Вердикт
<!-- заполняется в Stage 5 -->
