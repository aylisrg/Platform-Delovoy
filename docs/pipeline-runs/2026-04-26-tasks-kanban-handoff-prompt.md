# Handoff Prompt — Tasks Kanban Pipeline (2026-04-26-tasks-kanban)

> Этот файл — самодостаточный промпт для запуска полного pipeline в **новой сессии Claude Code**.
> Скопируй блок ниже и вставь в новый чат. Всё необходимое для PO/Architect/Developer/Reviewer/QA — внутри.

**Ветка для работы:** `claude/explore-task-module-M0CDO` (уже создана, на ней лежит context-log)
**Готовые артефакты:** `docs/context/2026-04-26-tasks-kanban-context.md`
**Референс старой реализации:** коммит `73b0226` (был откачен в `3f42155`)

---

## ⬇️ Скопируй всё ниже и вставь в новый чат Claude Code ⬇️

```
/feature

# Фича: «Задачи Делового» — единый канбан для всего парка

**RUN_ID:** 2026-04-26-tasks-kanban
**Ветка:** claude/explore-task-module-M0CDO (УЖЕ СОЗДАНА — checkout, не создавай заново)
**Контекст-лог:** docs/context/2026-04-26-tasks-kanban-context.md (уже создан, дочитывай и дополняй)

## Контекст

В коммите 73b0226 (PR #178) была попытка модуля `tasks` с дискриминатором Task.type ∈ {INTERNAL, ISSUE} (внутренний трекер + жалобы арендаторов). Откачен в PR #181 (коммит 3f42155) из-за scope creep — модуль не был в "Реальном списке модулей" CLAUDE.md.

Сейчас модуля в `src/modules/` НЕТ. Используем 73b0226 как **референс** для повторного использования вспомогательных файлов (office-matcher, public-id, mentions, tg-flow), но НЕ копируем 1-в-1 — переосмысливаем архитектуру.

## Запрос пользователя (5 ключевых требований)

1. **Один канбан вместо двух модулей.** Внутренние задачи и жалобы арендаторов — в одной доске. Никакого `Task.type` дискриминатора. Разница только в `source` (MANUAL/TELEGRAM/EMAIL/WEB/API) и наборе участников.

2. **Канбан как у 1С-Битрикс / Jira / Linear:**
   - Настраиваемые колонки через UI (НЕ хардкод enum). Менеджер сам определяет: «Входящие → В работе → Ждём поставщика → Готово»
   - WIP-лимиты по колонке
   - Swimlanes по: ответственному / категории / приоритету
   - Фильтры (категория, теги, приоритет, ответственный, дата) + сохранённые виды
   - Drag-n-drop карточек (`@dnd-kit` уже в deps)
   - Метки (labels) — массив строк
   - Кастомные поля задач — V2

3. **Гибкое назначение участников:**
   - **RESPONSIBLE** — один (главный исполнитель)
   - **COLLABORATOR** — N (соисполнители)
   - **WATCHER** — M (наблюдатели, только читают и получают уведомления)
   - Маршрутизация: категория → defaultResponsibleUserId → fallback «дежурный» → null
   - SLA + эскалация — описать как future, в V1 только базовая маршрутизация

4. **Channel-agnostic уведомления.** Сегодня Telegram + Email. Завтра WhatsApp, MAX, iMessage, SMS. Добавление канала = реализация интерфейса `NotificationChannel` (3 метода) + регистрация в `ChannelRegistry`. **НЕТ** хардкода Telegram в `NotificationDispatcher` или модуле tasks.

5. **Per-user notification preferences:** основной канал, резервный, типы событий, quiet hours, расписание.

## Каналы ввода задач

- Ручное создание в админке
- Веб-форма для арендаторов `/report` (публичная, rate-limited, debounced office-autosuggest, обработка `409 OFFICE_AMBIGUOUS`)
- Telegram-бот `/issue` (state machine с подтверждением личности через RentalContract → Tenant → Office)
- IMAP email (Yandex SMTP, корреляция `[TASK-XXXXX]` в subject, idempotency через `TaskComment.emailMessageId UNIQUE`)
- REST API `POST /api/tasks` (для будущих интеграций)

## Архитектурные решения (заданы — Architect должен их реализовать в ADR)

**Prisma schema:**
- `Task` БЕЗ поля `type`. Только `source: TaskSource`, `reporterUserId?` (внутренний) + `externalContact JSONB?` (внешний). `publicId` — `TASK-XXXXX` (32-символьный алфавит без 0/1/I/O).
- `TaskBoard` — настраиваемые доски (по умолчанию одна общая)
- `TaskColumn` — колонки доски (`name`, `color`, `sortOrder`, `isTerminal`, `wipLimit?`)
- `TaskAssignee` — many-to-many `(taskId, userId, role: RESPONSIBLE | COLLABORATOR | WATCHER)`. **Заменяет одиночный `assigneeUserId`.**
- `TaskCategory` (`defaultResponsibleUserId`, `keywords[]`, `priorityHint`)
- `TaskComment` (с `emailMessageId UNIQUE` для inbound idempotency), `TaskEvent` (timeline), `TaskSubscription`
- `NotificationChannel` (НОВАЯ сущность отдельно от модуля notifications): `id, userId, kind: TELEGRAM|WHATSAPP|MAX|IMESSAGE|EMAIL|SMS|..., address, verifiedAt, priority (1=primary), isActive`
- `NotificationPreference`: `userId, eventType, channels[], quietHoursFrom, quietHoursTo, timezone`
- `OutgoingNotification` (очередь): `id, userId, eventType, payload JSONB, channelId, status: PENDING|SENT|FAILED|DEFERRED, attempts, sentAt, failureReason`. Для retry/idempotency/audit.

**Channel-agnostic notification architecture:**
```ts
interface NotificationChannel {
  readonly kind: NotificationChannelKind;
  send(address: string, payload: NotificationPayload): Promise<DeliveryResult>;
  verify?(address: string): Promise<VerificationChallenge>;
  isAvailable(): boolean;
}
```
- `ChannelRegistry` собирает все реализации: `TelegramChannel`, `EmailChannel` (рабочие); `WhatsAppChannel`, `MaxChannel`, `iMessageChannel`, `SmsChannel` (заглушки со статусом `not yet configured` — `isAvailable() === false`)
- Универсальный `NotificationPayload` — markdown-like структура `{ title, body, actions[] }`. Каждый канал рендерит по-своему.
- `NotificationDispatcher` принимает событие → находит подписки → выбирает канал по приоритету (primary → fallback при `isAvailable()===false`) → ставит в `OutgoingNotification` (PENDING) → воркер отправляет через нужный канал.
- **Идемпотентность:** dedup по `(userId, eventType, entityId, hashOfPayload)` за окно 5 минут.
- **Quiet hours:** попадание в окно тишины → статус `DEFERRED`, отправка по выходу из окна.
- **Будущий канал** = создать класс с 3 методами + register в `ChannelRegistry`. Нулевые правки в `NotificationDispatcher` или модуле tasks.

**RBAC:**
- SUPERADMIN — всё
- ADMIN — всё кроме настроек ролей пользователей
- MANAGER — задачи в назначенных категориях/досках (через `ModuleAssignment`)
- Сотрудник — задачи где он responsible/collaborator/watcher
- USER (арендатор) — `/report` форма + просмотр своих обращений
- Аноним — `/report` форма (rate-limited по IP)

## Что должна сделать цепочка `/feature`

### Stage 1 — Product Owner → `docs/requirements/2026-04-26-tasks-kanban-prd.md`
- Бизнес-цель и проблема (2-3 параграфа)
- 6 персон (SUPERADMIN, ADMIN, MANAGER, Сотрудник, Арендатор-репортёр, Внешний-аноним)
- 12+ user stories с acceptance criteria (минимум 2-3 на персону)
- Канбан-функциональность с конкретными требованиями к UX
- Множественные участники (кто какие уведомления получает)
- Каналы ввода — путь пользователя для каждого
- Notification preferences — UX настройки
- Out-of-scope V1: спринты, тайм-трекинг, подзадачи, кастомные поля, API webhooks, мобилка
- Acceptance criteria — нумерованный список (AC-001 … AC-NNN)
- Метрики успеха (количественные, базовое + целевое)
- MoSCoW приоритизация
- **Обязательно**: требование добавить `tasks` в "Реальный список модулей" CLAUDE.md как Phase 5.x в том же PR что и код (Scope guard)

### Stage 2 — System Architect → `docs/architecture/2026-04-26-tasks-kanban-adr.md`
- Полная Prisma-схема (см. выше) + миграция
- Channel-agnostic архитектура (см. выше) + диаграмма потока
- API-контракты под `/api/tasks/*`, `/api/notifications/channels/*`, `/api/notifications/preferences/*`
- RBAC матрица для каждого endpoint
- Rate limiting per endpoint
- Zod-схемы валидации (общий план)
- Trade-offs: почему отказались от type-дискриминатора, почему вынесли каналы в отдельную сущность, влияние на производительность (индексы)
- Migration plan от текущего состояния (модуля нет)
- Список файлов для повторного использования из коммита 73b0226: office-matcher, public-id, mentions, tg-flow (адаптировать под новую схему)

### Stage 3 — Senior Developer (это делает основная сессия Claude, не субагент)
- Prisma schema + миграция
- `src/modules/tasks/` — board, column, assignees, service, routing, public-id, mentions, office-matcher, validation, types, scheduler-hooks, tg-flow, email-inbound
- `src/modules/notifications/` — рефакторинг под channel-agnostic: dispatcher.ts, channel-registry.ts, channels/{telegram,email,whatsapp,max,imessage,sms}.ts
- API routes: `/api/tasks/*`, `/api/notifications/channels/*`, `/api/notifications/preferences/*`
- Admin UI: `/admin/tasks` (kanban с настраиваемыми колонками через @dnd-kit), `/admin/tasks/[publicId]`, `/admin/tasks/categories`, `/admin/tasks/boards`, `/admin/notifications` (per-user channel settings)
- Telegram-бот: `/issue` (state machine), `/mytasks`, `/settings` (выбор каналов, расписание)
- Веб-форма `/report` (публичная)
- IMAP inbound email (gated `INBOUND_EMAIL_ENABLED`)
- Vitest unit + integration тесты, цель >85% coverage для service-слоя, мок БД через `vi.mock('@/lib/db')`
- Обновление `CLAUDE.md` — добавить `tasks` в реестр модулей и в Phase 5.x roadmap (в том же PR)

### Stage 4 — Code Reviewer → `docs/qa-reports/2026-04-26-tasks-kanban-review.md`
Проверить:
- Scope creep — нет фич вне PRD
- RBAC дыры в каждом endpoint
- Утечки секретов в API-ответах
- Channel-agnostic архитектура — НЕТ хардкода Telegram в Dispatcher
- CLAUDE.md синхронизирован
- Тесты покрывают acceptance criteria

### Stage 5 — QA → `docs/qa-reports/2026-04-26-tasks-kanban-qa-report.md`
- Прогон всех AC из PRD против реализации
- `npm test` зелёный
- TypeScript strict, no `any`
- Zod на всех входах
- AuditLog на мутации
- Rate limiting на публичных
- Verdict PASS/FAIL

## Ограничения

- TypeScript strict
- Zod на всех входах
- Бизнес-логика в `service.ts`, route handlers — тонкая обёртка
- Все мутации → AuditLog
- Тесты в том же коммите что и код
- Conventional commits (`feat(tasks):`, `feat(notifications):`)
- Ветка: `claude/explore-task-module-M0CDO` (УЖЕ создана!)
- Пушить в эту ветку, **НЕ мержить в main** без явного разрешения
- CLAUDE.md обновлять в том же PR

## Что важно НЕ забыть

- Channel-agnostic — это контракт, не «когда-нибудь добавим»
- Канбан = настраиваемая первоклассная сущность с TaskBoard/TaskColumn в БД, не enum в коде
- Множественное назначение через TaskAssignee с ролью (RESPONSIBLE|COLLABORATOR|WATCHER)
- Notification preferences per-user (primary/fallback/quiet hours)
- Scope guard: PRD → roadmap → код → CLAUDE.md в том же PR

## После завершения

Когда все 5 стадий пройдены и QA verdict=PASS — выведи финальный отчёт со списком артефактов, итераций Reviewer/QA, коммитов и результата `npm test`. PR в main НЕ создавай без явной просьбы пользователя.

Поехали.
```

---

## ⬆️ Конец промпта ⬆️

## Дополнительная инструкция для пользователя

В новой сессии:

1. Открой Claude Code в папке `/home/user/Platform-Delovoy`
2. Проверь, что ты на нужной ветке: `git branch --show-current` должен вернуть `claude/explore-task-module-M0CDO`
3. Скопируй промпт выше (от `/feature` до `Поехали.`) и вставь в чат
4. Claude запустит skill `feature` с готовым брифом и пройдёт все 5 стадий

## Альтернатива — автономный pipeline

Если хочешь полностью автономный прогон без участия в чате:

```bash
./scripts/pipeline.sh "<вставить-весь-блок-промпта-сюда>"
```

Скрипт сам прогонит PO → Architect → Developer → Reviewer → QA с feedback-loops.
