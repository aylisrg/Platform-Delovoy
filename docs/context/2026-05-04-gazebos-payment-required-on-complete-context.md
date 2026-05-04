# Context: F3 — Gazebos payment gate

**RUN_ID**: `2026-05-04-gazebos-payment-required-on-complete`  
**Branch**: `claude/fix-booking-session-closure-7SSOS`  
**Дата**: 2026-05-04  
**PRD**: `docs/requirements/2026-05-04-gazebos-payment-required-on-complete-prd.md`

---

## PO — Ключевые решения

### R1: Скоуп F3 — только запрет без оплаты, без UI сессии

Решение принято на основе прямого ответа заказчика: требуется перенести ровно то же правило, что в PS Park (F1). Ни «активная сессия», ни визуальный таймер беседок в этой итерации не создаются. Любые попытки добавить эту функциональность в PR F3 считаются scope creep и должны быть отклонены Reviewer.

### R2: Прямой перенос паттерна F1, без изобретения нового

F1 (PR #236) — единственный образец. Архитектурных решений в PS Park менять не нужно. Gazebos service наследует ту же структуру: `actorRole`, payment gate, `updateMany` race guard, `FinancialTransaction` в транзакции, audit log. Это снижает риск расхождения поведения модулей и упрощает review.

### R3: Схема БД не меняется

Поля `Booking.cashAmount`, `Booking.cardAmount` и модель `FinancialTransaction` с `SESSION_PAYMENT` уже присутствуют в `prisma/schema.prisma`. Миграция не требуется — это подтверждено чтением схемы (строки 197-198, 247-265). Architect не должен создавать новую миграцию для этого тикета.

### R4: `totalBill` — открытый вопрос для Architect (снэпшот vs пересчёт)

В PS Park `totalBill` вычисляется в реальном времени от `startTime` до `min(endTime, now)` (клиент платит за фактическое время). Для беседок семантика иная: клиент бронирует конкретный слот и, как правило, оплачивает его целиком. PO оставляет этот выбор за Architect — важно зафиксировать решение в ADR или комментарии к PR.

### R5: CRON auto-complete для беседок не обнаружен

Проверено: в `src/modules/gazebos/service.ts` нет вызовов с `actorRole="CRON"` для перехода в COMPLETED (только NO_SHOW через `markNoShow`). Параметр `actorRole` добавляется только для симметрии с F1, gate корректно обходится при `actorRole="CRON"` — это страховка на будущее, не текущая функциональность.

### R6: Тесты — обязательны в том же коммите

Согласно CLAUDE.md, тесты пишутся в том же коммите что и код. Для F3 минимум: 6 тест-кейсов по AC-1..AC-6 в `src/modules/gazebos/__tests__/service.test.ts`. Все моки через `vi.mock('@/lib/db')`, без реальной БД.

### R7: Ошибки `BookingError` + `details`

Существующий `BookingError` (`service.ts:1052`) не принимает третий аргумент `details`. Для AC-1/AC-2 необходима передача `shortfall`, `totalBill`, `paid` в теле ответа 422. Architect решает: расширить `BookingError` или создать `GazeboBookingError`. Главное требование PO — `details` должны быть доступны в route handler для маппинга в тело API-ответа.
