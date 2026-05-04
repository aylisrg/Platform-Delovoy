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

---

## Architect — Ключевые решения

ADR: [`docs/architecture/2026-05-04-gazebos-payment-required-on-complete-adr.md`](../architecture/2026-05-04-gazebos-payment-required-on-complete-adr.md)

### A1: Variant inline copy-paste из F1, без shared-helper

Решение по PO Open Q #1 / Architect Open Q #1 — **inline**. Выделять `src/modules/booking/payment-gate.ts` сейчас означает рефакторинг F1 (уже в main), что нарушает CLAUDE.md «PR ≤ одна фича». Helper будет выделен **позже**, когда появится третий потребитель (sauna в Phase 5.x). YAGNI. Дублирование осознанное и временное (~20 строк).

### A2: `totalBill` — снэпшот `metadata.totalPrice`, не пересчёт

Закрывает PRD Open Q #2 / Architect Open Q #2. **Снэпшот.** Беседки — фикс-цена за забронированный слот, не pay-as-you-go (в отличие от PS Park игровых сессий). `computeGazeboPricing` (`src/modules/gazebos/pricing.ts:108–141`) уже корректно учитывает weekday/weekend и дневной тариф — используем готовый `Booking.metadata.totalPrice`. Тест T7 явно защищает это решение (регресс на «сделать как в PS Park»).

### A3: Округление `billedHours` — не применяется

Следствие A2. При снэпшоте `totalPrice` 15-минутный шаг PS Park не релевантен — рассчёт часов уже зашит в `computeGazeboPricing`. Закрывает Architect Open Q #3.

### A4: Расширяем существующий `BookingError`, новый класс не создаём

Закрывает Architect Open Q #4. `BookingError` уже импортирован в gazebos в 8+ местах (`service.ts:132,144,149,179,251,256,280,375,389,477,598,606,705,720,751,767`) и в роуте (`route.ts:13`). Создание `GazeboBookingError` ломает все импорты ради косметики. Добавляем опциональный 3-й аргумент `metadata?: Record<string, unknown>` — полностью backward-compatible.

### A5: Сигнатура `updateBookingStatus` — bit-to-bit с PS Park

Закрывает Architect Open Q #5. Новый порядок параметров: `(id, status, managerId?, cancelReason?, cashAmount?, cardAmount?, discountInput?, actorRole?)`. Симметрия с `src/modules/ps-park/service.ts:226–235`. Это упрощает менторскую работу, диагональное чтение и (в будущем) выделение shared-helper'а — без миграции на разные сигнатуры.

### A6: Новый `gazebo-bill-modal.tsx`, не переиспользуем PS Park modal

PS Park `session-bill-modal.tsx` тесно связан с типом `BookingBill` (items, billedHours, durationMin, hoursCost) — для беседок без items это лишний шум. Импорт PS Park компонента в gazebos нарушает domain isolation (CLAUDE.md). Создаём упрощённый `src/components/admin/gazebos/gazebo-bill-modal.tsx` с минимальным `GazeboBill` (resourceName, clientName, date, startTime, endTime, totalBill). Логика split cash/card, discount toggle, `isUnderpaid` guard — копируется. ~150 строк дублирования осознанно.

### A7: Audit action — `booking.complete`, не `session.complete`

gazebos оперирует «бронированиями», PS Park — «сессиями». Семантика отличается. Парный CRON-вариант — `booking.auto_complete`. Это не нарушает никаких существующих агрегаций (analytics/reports фильтруют по `entity="Booking"`, а не по action-имени).

### A8: HTTP-mapping (по образцу F1)

422 для `PAYMENT_REQUIRED` и `DISCOUNT_EXCEEDS_LIMIT` (бизнес-инвариант не выполнен, RFC 4918). 409 для `ALREADY_COMPLETED`, `ALREADY_CANCELLED`, `INVALID_STATUS_TRANSITION` (конфликт состояния). 400 для остального. Полный set — копируется из `src/app/api/ps-park/bookings/[id]/route.ts:119–134`.

### A9: RBAC и rate limiting — без изменений

`PATCH /api/gazebos/bookings/:id` уже защищён цепочкой `auth() → requireAdminSection("gazebos") → MANAGER/SUPERADMIN`. USER может только cancel своих броней. Новых endpoint'ов нет, новых ролей нет, rate limit наследуется от глобального middleware (120 req/min для авторизованных).

### A10: Влияние на analytics / rental — нулевое

`getAnalytics` в `gazebos/service.ts:892–997` уже считает revenue из `metadata.totalPrice`. После F3 появятся ещё `FinancialTransaction` записи — это обновление **источника истины** для будущего dashboard Phase 5.3, но в этом PR analytics не меняются. `rental/reports` не делает aggregations по `FinancialTransaction.moduleSlug` — конфликта нет.

### A11: Файлы под изменения (5 файлов)

1. `src/modules/gazebos/service.ts` — расширение `updateBookingStatus`, переписывание COMPLETED branch (`service.ts:469–549`), расширение `BookingError` (`service.ts:1052–1058`).
2. `src/modules/gazebos/__tests__/service.test.ts` — добавить mocks `booking.updateMany`, `booking.findUniqueOrThrow`, `financialTransaction.create` + 9 тест-кейсов T1–T9.
3. `src/app/api/gazebos/bookings/[id]/route.ts` — парсить `cashAmount`/`cardAmount` (route.ts:55), пробросить в сервис (route.ts:84), error mapping (route.ts:108–114).
4. `src/components/admin/gazebos/booking-actions.tsx` — переделка: «Завершить» открывает modal вместо прямого PATCH, удалить отдельную кнопку «Завершить со скидкой».
5. `src/components/admin/gazebos/gazebo-bill-modal.tsx` — **новый файл**.

Без миграций, без новых endpoints, без npm-зависимостей.
