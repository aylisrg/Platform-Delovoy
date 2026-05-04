# PRD: PS Park — запрет завершения сессии без оплаты (F1)

**RUN_ID**: `2026-05-04-ps-park-payment-required-on-complete`
**Дата**: 2026-05-04
**Статус**: Готов к передаче Architect
**Ветка**: `claude/fix-booking-session-closure-7SSOS`

---

## Проблема

Менеджер PlayStation Park может закрыть игровую сессию (перевести бронь в статус `COMPLETED`) не получив от клиента ни рубля. Это происходит потому, что `updateBookingStatus` в `src/modules/ps-park/service.ts` принимает `cashAmount` и `cardAmount` без проверки того, покрывают ли они выставленный счёт. В `src/components/admin/ps-park/session-bill-modal.tsx` кнопка «Завершить сессию» блокируется только при `!isBalanced` — то есть когда `cash + card != effectiveTotal`. Но `effectiveTotal` может быть равен нулю, если оба поля выставлены в 0 вручную или если менеджер обнулил их перед подтверждением.

Следствия для бизнеса:

- **Потеря выручки**: сессия завершена, стол освобождён, `FinancialTransaction` создана на 0 ₽ — деньги в кассе не появились, но в аналитике сессия числится как оплаченная.
- **Неотслеживаемые «подарки»**: менеджер фактически делает 100%-скидку «молчком», без `discountReason` в `AuditLog`.
- **Неверная аналитика смены**: `ShiftHandover` агрегирует `FinancialTransaction`, нулевые транзакции искажают `cashTotal`/`cardTotal` и выручку дня.
- **«Диванный» workflow**: сессия закрыта, менеджер планировал «провести наличку позже» — не провёл. Деньги потеряны навсегда, т.к. `FinancialTransaction` immutable.

---

## Решение

Добавить gate-проверку на уровне бизнес-логики (`src/modules/ps-park/service.ts`) в ветке `status === "COMPLETED"` функции `updateBookingStatus`: если `totalBill > 0` и `(cashAmount ?? 0) + (cardAmount ?? 0) < totalBill` после применения скидки — выбросить `PSBookingError("PAYMENT_REQUIRED", ...)`. API вернёт 422 с кодом `PAYMENT_REQUIRED` и разницей в рублях. UI (`session-bill-modal.tsx`) уже показывает красный индикатор при `!isBalanced` — дополнительно явно показать причину блокировки из тела ответа.

Никаких новых полей в схеме БД. Никаких новых моделей.

---

## Целевая аудитория

**MANAGER** PlayStation Park (единственный актор, закрывающий сессии вручную через UI).

---

## In Scope

- Модуль `ps-park` (`moduleSlug = 'ps-park'`) — только.
- Проверка в `updateBookingStatus` (бизнес-логика, `src/modules/ps-park/service.ts`).
- Валидация в route handler `PATCH /api/ps-park/bookings/:id` (Zod-схема в `src/modules/ps-park/validation.ts`).
- Отображение ошибки в `src/components/admin/ps-park/complete-session-button.tsx`.
- Обработка edge case `actorRole === "CRON"` (auto-complete без оплаты).
- Обработка edge case `totalBill === 0`.
- Unit-тесты для новой логики (`src/modules/ps-park/__tests__/service.test.ts`).

---

## Вне скоупа

- **Беседки (gazebos)** — аналогичная проверка будет отдельным тикетом F3 после merge F1.
- **UI красной карточки истёкшей сессии** — тикет F2, отдельная итерация.
- **Карточка гостя** — тикет F4.
- **Order.bookingId** — тикет F5.
- **Абонементы** — тикеты F6/F7.
- **Изменение схемы Prisma** — никаких новых полей или моделей в `prisma/schema.prisma`.
- **Онлайн-эквайринг / интеграция платёжных систем** — не входит в эту итерацию.
- **Повторный расчёт уже завершённых сессий** — исторические данные не трогаем.

---

## User Stories

### US-1: Блокировка при нулевой оплате

- **Как** менеджер PS Park
- **Я хочу** получить понятную ошибку при попытке завершить сессию без ввода суммы оплаты
- **Чтобы** не терять выручку из-за случайного закрытия «на диван»

**Acceptance Criteria:**

1. **Given** сессия с `totalBill > 0` (например, 300 ₽ за 1 час), `CONFIRMED` или `CHECKED_IN`; **When** менеджер нажимает «Завершить» с `cashAmount = 0` и `cardAmount = 0` без скидки; **Then** API отвечает `422` с кодом `PAYMENT_REQUIRED` и сообщением «Необходимо принять оплату: не хватает X ₽», сессия остаётся в исходном статусе (`CONFIRMED` / `CHECKED_IN`), запись в `FinancialTransaction` не создаётся.

2. **Given** сессия с `totalBill = 500 ₽`; **When** менеджер вводит `cash = 300, card = 0` (недоплата 200 ₽) без скидки; **Then** API отвечает `422` с кодом `PAYMENT_REQUIRED` и сообщением «Необходимо принять оплату: не хватает 200 ₽», статус не меняется.

3. **Given** сессия с `totalBill = 500 ₽`; **When** менеджер вводит `cash = 300, card = 200` (итого 500 ₽); **Then** API отвечает `200`, статус → `COMPLETED`, `FinancialTransaction` создаётся с `totalAmount = 500`, `cashAmount = 300`, `cardAmount = 200`.

4. **Given** менеджер применяет скидку 100% с `discountReason = "venue_expense"` (причина длиной ≥ 3 символов) и `effectiveTotal = 0`; **When** подтверждает; **Then** API принимает `cashAmount = 0, cardAmount = 0` как корректную оплату (т.к. `effectiveTotal = 0`), создаёт `FinancialTransaction` с `totalAmount = 0` и `AuditLog.action = "booking.discount_applied"` с `discountPercent = 100` и непустым `discountReason`.

5. **Given** менеджер применяет ненулевую скидку, но `discountReason` пуст или короче 3 символов; **When** пытается отправить форму; **Then** UI блокирует submit (`discountValid === false` в `session-bill-modal.tsx`, строка 104), запрос до API не доходит.

6. **Given** менеджер вводит `cardAmount > totalBill` (переплата, например, `card = 600` при `totalBill = 500`); **When** подтверждает; **Then** API принимает запрос (переплата разрешена — сдача менеджер выдаёт сам), создаёт `FinancialTransaction` с реально введёнными суммами, статус → `COMPLETED`.

7. **Given** сессия с `totalBill = 0` (нет тарифа у стола, нет items, `billedHours = 0`); **When** менеджер завершает с `cashAmount = 0, cardAmount = 0`; **Then** API принимает запрос, создаёт `FinancialTransaction` с `totalAmount = 0`, статус → `COMPLETED`. Оплата для нулевых сессий не требуется.

8. **Given** два менеджера одновременно открыли модалку для одной сессии и одновременно нажимают «Завершить» с корректными суммами (race condition); **When** оба запроса достигают `updateBookingStatus`; **Then** транзакция с `updateMany({ where: { id, status: { in: ["CONFIRMED", "CHECKED_IN"] } } })` гарантирует, что только один запрос получит `count > 0` и создаст `FinancialTransaction`; второй запрос получит `PSBookingError("ALREADY_COMPLETED")`, который API вернёт как `409`, UI покажет «Сессия уже завершена».

---

## Edge Cases

### totalBill = 0

Техническая бронь: стол создан без `pricePerHour`, нет items в metadata, `billedHours = 0`. Решение: если `completedTotalBill === 0` после применения скидки, требование оплаты снимается. Проверка: `if (completedTotalBill > 0 && (resolvedCash + resolvedCard) < completedTotalBill) → PAYMENT_REQUIRED`.

### discountPercent > 100

Уже заблокировано Zod-схемой (`max(100)`). Дополнительных действий не требуется.

### cardAmount > totalBill (переплата)

Разрешена. Сдачу менеджер возвращает наличными — это не зона ответственности системы. `FinancialTransaction` записывает введённые суммы как есть.

### actorRole = "CRON" (auto-complete по расписанию)

Функция `autoCompleteExpiredSessions` вызывает `updateBookingStatus(..., "CRON")` без `cashAmount` и `cardAmount` (оба `undefined`). Решение: CRON-завершение **исключено из payment-gate**. Когда `actorRole === "CRON"`, проверка `PAYMENT_REQUIRED` не применяется; `resolvedCash = 0, resolvedCard = 0`, `FinancialTransaction.totalAmount = completedTotalBill`. Сессия попадает в `AuditLog.action = "session.auto_complete"` — менеджер видит её в дашборде как требующую ручного reconciliation. Это явно зафиксировано в `AuditLog.metadata.actor = "CRON"` (уже реализовано, строка 494 service.ts).

Обоснование: CRON-завершение — это safety net при зависших сессиях. Блокировать его означало бы оставлять стол навечно занятым при недосмотре менеджера. Задолженность reconcile-ится по `AuditLog`.

---

## Приоритет (MoSCoW)

**Must have** — прямая потеря выручки при каждом «случайном» или намеренном закрытии без оплаты. Платформа находится на стадии pre-launch (Phase 5.0), и этот баг способен систематически искажать финансовую отчётность с первого дня.

Зависимости: нет внешних. Изменение локализовано в `src/modules/ps-park/service.ts` и `src/modules/ps-park/validation.ts`. Route handler `PATCH /api/ps-park/bookings/:id` не меняется (только обрабатывает новый код ошибки).

---

## Метрики успеха

| Метрика | Сейчас (базовое) | Цель (после релиза) |
|---------|-----------------|---------------------|
| COMPLETED брони с `cashAmount + cardAmount = 0` и без `discountReason` в AuditLog | неизвестно (проверить SQL-инвариантом) | 0 |
| `FinancialTransaction` с `totalAmount = 0` без `discountPercent = 100` в metadata | неизвестно | 0 |
| Ошибки типа `PAYMENT_REQUIRED` в `SystemEvent` / AuditLog за первую неделю | 0 (тип не существует) | метрика собирается, порог — норма (ожидаемы при обучении менеджеров) |

**SQL-инвариант для мониторинга** (проверять еженедельно после релиза):

```sql
SELECT b.id, b."clientName", ft."totalAmount", ft."cashAmount", ft."cardAmount"
FROM "Booking" b
JOIN "FinancialTransaction" ft ON ft."bookingId" = b.id
WHERE b."moduleSlug" = 'ps-park'
  AND b.status = 'COMPLETED'
  AND ft.type = 'SESSION_PAYMENT'
  AND ft."totalAmount" > 0
  AND (ft."cashAmount" + ft."cardAmount") = 0;
-- Результат должен быть пустым
```

---

## Риски и митигация

| Риск | Вероятность | Митигация |
|------|------------|-----------|
| Менеджер привык закрывать сессию «без оплаты», чтобы «провести наличку позже» | Средняя | Явная коммуникация: этот workflow отменяется. Если оплата получена наличными, но не проведена сразу — менеджер должен ввести сумму прямо сейчас. Резервный сценарий: 100%-скидка с `discountReason = "venue_expense"` + комментарий «наличные отданы, не внесены» — это теперь единственный легальный способ закрыть без реального платежа, и он оставляет след в AuditLog. |
| Сломанный CRON auto-complete при внедрении gate | Низкая | `actorRole === "CRON"` явно исключён из проверки (см. Edge Cases). |
| Переплата вызывает путаницу у менеджера | Низкая | Переплата разрешена, UI уже показывает `isBalanced = true` при `cash + card >= effectiveTotal` — проверить, что логика корректна после этого PRD. |
| Двойное завершение (race condition) | Низкая | Уже защищено `updateMany` с `status guard` + `ALREADY_COMPLETED` (строки 458–470 service.ts). |

---

## Что уже реализовано (не трогать)

- `isBalanced` в `session-bill-modal.tsx` (строки 65–66): UI-проверка, что `cash + card = effectiveTotal`. Это UX-слой, не security. Gate на уровне API — отдельно и обязателен.
- `discountValid` (строки 104–109): блокировка submit при некорректной скидке. Остаётся без изменений.
- Race condition guard (`updateMany` + `ALREADY_COMPLETED`) в строках 454–470 service.ts. Остаётся без изменений.
- `actorRole = "CRON"` и `session.auto_complete` в AuditLog (строки 493–494 service.ts). Остаётся без изменений.
