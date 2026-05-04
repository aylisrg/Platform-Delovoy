# Context Log — 2026-05-04 — F6: Абонементы (Subscriptions) — модель + admin CRUD

> RUN_ID: `2026-05-04-subscriptions-module-impl`
> Branch: `claude/wave-3-subscriptions-impl`
> Wave 3 (план: `/root/.claude/plans/flickering-sauteeing-acorn.md`)
> PRD: `docs/requirements/2026-05-04-subscriptions-module-prd.md` (уже в main, PR #237)

## Задача

Полная реализация модуля абонементов: новая Prisma-схема (`Subscription` + `SubscriptionTransaction`), CRUD-сервис, admin-страница `/admin/ps-park/subscriptions`, API endpoints. Без логики автосписания при completion (это F7).

## Pipeline approval

Заказчик: «давай закончим всё что мы не доделали» = неявное PASS на F6 PRD. Architect → Developer → Reviewer → QA.

## Ключевые решения PO (из PRD)

- Один ACTIVE абонемент на гостя (жёсткий инвариант — partial UNIQUE).
- `SubscriptionTransaction` immutable (no updatedAt), like `FinancialTransaction`.
- Decimal(10, 2) для часов (шаг 0.25h = 15 мин — совместим с PS Park).
- Status enum: ACTIVE / EXPIRED / DEPLETED / CANCELLED.
- INSUFFICIENT_HOURS — 422 при попытке списать > remainingHours (no clamp).

## Stages

- [x] PO — PRD (в main)
- [x] Architect — ADR
- [ ] Developer — implementation
- [ ] Reviewer — audit
- [ ] QA — verify

## Architect — Ключевые решения

ADR: `docs/architecture/2026-05-04-subscriptions-module-impl-adr.md`

### Закрытие 4 open questions PO (Decisions matrix)

1. **Auto-status (EXPIRED/DEPLETED) — lazy при чтении**, без cron. Функция `recomputeStatusIfStale(sub)` вызывается в `getSubscription`, `listSubscriptions` (батч-update до основного SELECT) и `getActiveSubscriptionForUser`. Concurrent-safe через `updateMany WHERE id=… AND status='ACTIVE'` (atomic compare-and-swap). Cron — оставляем на Phase 5.x.
2. **Защита от race "два ACTIVE"** — **partial UNIQUE index** в Postgres `WHERE status='ACTIVE'`. Дешевле SELECT FOR UPDATE / optimistic lock. Prisma не поддерживает partial — добавлен через raw SQL в migration. Аналог `inventory_sku_active_name_lower_unique`.
3. **Продление validTo через PATCH — запрещено.** PATCH меняет только `notes` и `pricePaid`. Для продления — `cancel + create new`. Zod schema `.strict()` блокирует левые поля. Корректировка часов — отдельный POST `/adjust` (не PATCH — семантически чище, аналог inventory adjust).
4. **Manual deduct в минус — 422 `INSUFFICIENT_HOURS`** с metadata `{remainingHours, requested}`. Никакого clamp до 0 (defensive — clamp скрывает баги).

### Архитектурные дополнения

- **Naming:** PRD использовал `SubscriptionTransactionReason` — Architect выбрал `SubscriptionTransactionType` для консистентности с `FinancialTxType` / `InventoryTransactionType`.
- **Первая транзакция при create** — добавлена автоматически (`MANUAL_TOPUP, hoursDelta=totalHours, reason="initial purchase"`), чтобы единый journal начинался с момента покупки и `balanceAfter` всегда был осмысленным.
- **`balanceAfter` snapshot** в каждой `SubscriptionTransaction` — для drill-down в UI без пересчёта (по образцу `StockMovement.balanceAfter` из inventory).
- **`performedByName` денормализация** — как в `FinancialTransaction.performedByName`. Имя менеджера остаётся осмысленным даже если пользователь потом удалён.
- **Cancel — только SUPERADMIN** через `hasRole(session.user, "SUPERADMIN")`. Adjust/create/update — MANAGER+ через `requireAdminSection(session, "ps-park")`.
- **Не добавляем `subscriptions` в `ADMIN_SECTIONS`** — это под-раздел `ps-park`, отдельный grant создал бы лишнюю сущность для менеджеров.

### Файлы для Developer

См. ADR §9 — точный список (17 новых файлов + 5 изменений). Ключевые:

- `prisma/migrations/20260504120000_subscriptions/migration.sql` — schema + partial UNIQUE
- `src/modules/subscriptions/{service,validation,types}.ts`
- `src/modules/subscriptions/__tests__/service.test.ts` (≥ 8 тестов)
- `src/app/api/subscriptions/route.ts` + `[id]/route.ts` + `[id]/adjust/route.ts` + `[id]/cancel/route.ts`
- `src/app/admin/ps-park/subscriptions/{page,[id]/page}.tsx`
- `src/components/admin/subscriptions/{subscription-form,adjust-hours-modal,cancel-subscription-modal,subscriptions-list-table}.tsx`
- Изменить `src/components/admin/clients/client-profile.tsx` (вкладка "Абонементы")
- Обновить `CLAUDE.md` (раздел "Реальный список модулей" + строка `subscriptions \| Phase 5.x \| абонементы PS Park`) — **в том же PR** (anti-scope-creep правило).

### Anti-scope-creep напоминание Developer

- **F7 (charge при `booking.status → COMPLETED` + drilldown по сессиям) — НЕ ДЕЛАТЬ в этом PR.** F6 экспортирует только `getActiveSubscriptionForUser` как public helper. Никакой интеграции с Booking state machine.
- **Public-facing API для USER (просмотр своего абонемента) — НЕ ДЕЛАТЬ.** Out of scope per PRD §Вне скоупа.
- **Telegram-бот / уведомления / loyalty interplay — НЕ ДЕЛАТЬ.** Out of scope.
- **Refund/возврат денег — НЕ автоматизируем.** Per PRD §AC-5.3.
