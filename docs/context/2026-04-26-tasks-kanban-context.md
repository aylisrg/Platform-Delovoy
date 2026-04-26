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
<!-- заполняется product-owner агентом в Stage 1 -->

## Architect — Ключевые решения
<!-- заполняется system-architect агентом в Stage 2 -->

## Developer — Решения и отступления от ADR
<!-- заполняется в Stage 3 -->

## Reviewer — Вердикт и итерации
<!-- заполняется в Stage 4 -->

## QA — Вердикт
<!-- заполняется в Stage 5 -->
