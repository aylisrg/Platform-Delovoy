# Context Log — 2026-05-04 — F7: Drill-down + автосписание абонемента

> RUN_ID: `2026-05-04-subscription-debit-and-drilldown`
> Branch: `claude/wave-3-subscriptions-impl` (общая Wave 3 ветка)
> Wave 3 (план: `/root/.claude/plans/flickering-sauteeing-acorn.md`)

## Задача

Главная фича требования №4 заказчика. Две части:
1. **Автосписание из абонемента при `COMPLETED`** в PS Park: если у гостя ACTIVE Subscription с `remainingHours >= sessionHours`, менеджер видит чекбокс «оплатить из абонемента» в `session-bill-modal`. При подтверждении — атомарное списание `remainingHours` + `SubscriptionTransaction(type=DEBIT_SESSION)` внутри той же транзакции, что и FinancialTransaction. Guard F1 пропускает, если `subscription credit + cash + card >= totalBill`.
2. **Drill-down прошедшей сессии**: страница `/admin/ps-park/sessions/[id]` (или вкладка в карточке гостя) — детали брони + связанные кафе-заказы (через F5 link `Order.bookingId`) + платёж (cash/card/абонемент).

## Зависимости

- F1 (PS Park guard) — в main ✅
- F5 (Order.bookingId) — в main ✅
- F6 (Subscription модель) — в этой же ветке (Wave 3 начало)

## Stages

- [x] PO — PRD (`docs/requirements/2026-05-04-subscription-debit-and-drilldown-prd.md`)
- [x] Architect — ADR (`docs/architecture/2026-05-04-subscription-debit-and-drilldown-adr.md`)
- [ ] Developer — implementation
- [ ] Reviewer — audit
- [ ] QA — verify

---

## PO — Ключевые решения

### Решение 1: Toggle по умолчанию выключен (opt-in)

Абонементный toggle в `session-bill-modal` отображается, но **выключен по умолчанию**. Менеджер явно переключает его, прежде чем подтвердить.

**Обоснование**: Избегаем случайного списания часов, если гость хочет заплатить наличными, а не «тратить» абонемент. Менеджер знает намерение гостя — именно он должен делать выбор осознанно. Альтернатива «включён по умолчанию» приводит к тому, что забывчивый менеджер спишет часы против желания гостя.

---

### Решение 2: Скидка и абонемент несовместимы (взаимоисключение)

При включённом toggle секция скидки блокируется. Комбинировать нельзя — это упрощение V1.

**Обоснование**: Кейс «скидка на сессию + списание с абонемента» экономически нелогичен (абонемент уже фиксирует цену), и его реализация усложнила бы расчёт финансовой транзакции. Если потребность появится — отдельный тикет с пересмотром модели ценообразования абонементов.

---

### Решение 3: Drill-down — отдельная страница, а не вкладка

Страница детали сессии реализуется как `/admin/ps-park/sessions/[id]`, а не как вкладка в карточке гостя.

**Обоснование**: Постоянный URL нужен для трёх сценариев: (а) линковка из таблицы истории, (б) потенциальный permalink в Telegram-алертах в будущем, (в) навигация назад через браузер без потери позиции в таблице. Вкладка в карточке гостя не решает (а) и (б).

---

### Решение 4: Частичное покрытие абонементом — вне скоупа

«Либо полностью абонемент, либо cash/card» — бинарный выбор без дробления.

**Обоснование**: split-оплата (N часов с абонемента + остаток наличными) требует отдельной модели ценообразования в FinancialTransaction и усложняет UI. Операционно менеджерам достаточно бинарного выбора: есть часы — списывай, нет — плати деньгами. Если бизнес потребует split — выносим в отдельный тикет.

---

### Решение 5: Guard F1 расширяется через `subscriptionCredit`, не обходной флаг

Существующий payment guard (`cashAmount + cardAmount >= totalBill`) расширяется до `cashAmount + cardAmount + subscriptionCredit >= totalBill`. При subscription debit `subscriptionCredit = totalBill`, `cash = 0`, `card = 0`.

**Обоснование**: Обходной флаг `skipPaymentGate: true` нарушил бы инвариант guard-а и создал вектор для случайного или злонамеренного пропуска проверки. Аддитивное слагаемое сохраняет единую логику для CRON, cash, card и subscription.

---

### Решение 6: Возврат часов при отмене — вне скоупа F7

Если сессия уже COMPLETED, возврат часов на абонемент не происходит автоматически.

**Обоснование**: Workflow отмены COMPLETED сессии требует отдельного процесса с согласованием (разрешение суперадмина). Автоматический возврат без явного approval создаёт риск мошенничества. Фиксируем как «Won't have» для F7, будущий тикет описывает полный workflow рефанда.

---

## Architect — Ключевые решения

### A1: `debitFromSession` — отдельный файл `src/modules/subscriptions/debit.ts`

Helper выделен в собственный файл (а не положен в `subscriptions/service.ts`), потому что (а) F6 service.ts уже содержит CRUD + lazy-status + adjust + cancel и плотный, (б) `debitFromSession` имеет сильно отличающийся контракт (`tx: Prisma.TransactionClient` извне, вызывается из ps-park, не имеет UI), (в) изолированный файл = изолированные тесты (`debit.test.ts` mock'ает только tx, не весь Prisma client).

**Контракт**: `debitFromSession(tx, { subscriptionId, bookingId, hours, performedById, performedByName })` → `{ hoursDebited, remainingAfter, becameDepleted }`. Внутри: race-safe `updateMany WHERE id=? AND status=ACTIVE AND remainingHours >= ? { decrement }` + поствыборка для balanceAfter + auto-DEPLETED при нуле + ST insert (`type=CHARGE`) + AuditLog (`subscription.debit_session`). Throws `SubscriptionDebitError("INSUFFICIENT_HOURS")` если race потерян (count=0).

### A2: Guard F1 расширяется добавлением `subscriptionCredit`, вычисляемым на сервере из `subscriptionId`

Payload содержит ТОЛЬКО `subscriptionId?: string`. Сервер выполняет pre-flight: загружает sub через `getActiveSubscriptionForUser(booking.userId)` (lazy auto-EXPIRED/auto-DEPLETED работает), сверяет с переданным id (race-catch), проверяет `remainingHours >= billedHours` (defensive 422 INSUFFICIENT_HOURS). Если всё ок → `subscriptionCredit = completedTotalBill` (бинарный режим, Решение 4 PO). F1 guard превращается в `paid + subscriptionCredit >= totalBill` — единый аддитивный инвариант (Решение 5 PO).

UI не может «обмануть» guard, потому что serverside загружает реальный `Subscription.remainingHours` и реальный `completedTotalBill` из `Resource.pricePerHour + items` — оба не trust'ятся из payload.

### A3: Drill-down endpoint — новый `GET /api/ps-park/sessions/[id]`

Не расширяем `bookings/[id]/route.ts` (уже 207 строк, и семантически `/sessions/:id` — read-only DTO-агрегатор для UI, отличный от operations над брони). DTO жёстко зафиксирован: `{ session, orders, payment }` с `payment.method ∈ { CASH | CARD | MIXED | SUBSCRIPTION | FREE }`. Service-layer helper `getSessionDetail(id)` переиспользуется и роутом, и server-component страницей `/admin/ps-park/sessions/[id]/page.tsx` — single source of truth для DTO.

RBAC: `auth() + requireAdminSection(session, "ps-park")` — те же helpers, что и для существующих ps-park endpoints. Soft-deleted booking → 404. Гостевая бронь без userId — DTO без `client.userId` и без subscription block.

### A4: Mutex — единое 422 `INVALID_PAYMENT_COMBINATION` при ЛЮБОЙ из несовместимостей

`subscriptionId` несовместим с `discountInput` И с `cashAmount > 0` И с `cardAmount > 0`. Один error code (не три отдельных) упрощает UI handling и даёт оператору одно семантическое сообщение «выберите либо абонемент, либо деньги/скидку» вместо разбора трёх кодов. Metadata содержит `{ hasDiscount, hasCash, hasCard }` — для отладки и telemetry, если понадобятся.

Guard работает ДО открытия `prisma.$transaction` — никаких частичных мутаций.

### A5: Endpoint `/api/clients/:userId/subscriptions/active` — добавлен в скоуп F7

PRD parent agent предложил «добавь как часть F6 dependencies». Архитектор НЕ добавляет post-hoc в F6 (F6 PR уже сдаётся), а вводит endpoint в F7. Реализация — тонкая обёртка над `getActiveSubscriptionForUser` (F6 helper), доступная под `requireAdminSection("ps-park")`. Используется `complete-session-button.tsx` для предзагрузки toggle state перед открытием `SessionBillModal`.

### A6: `SubscriptionTransaction.type` для авто-debit = `CHARGE` (existing F6 enum)

PRD AC-6 пишет `type=DEBIT_SESSION`, но F6 ADR §4.1 уже зафиксировал enum `SubscriptionTransactionType { CHARGE | REFUND | MANUAL_TOPUP | MANUAL_DEDUCT }` — `CHARGE` явно описан как «авто-списание из F7». Architect использует existing enum value, не вводит новый. AuditLog `action='subscription.debit_session'` остаётся как semantic для grep-ability в логах. Расхождение naming зафиксировано в §4.1 ADR clarification.

### A7: Backward-compat для `updateBookingStatus` — 9-й опциональный параметр

`subscriptionId?: string` добавляется как 9-й параметр после `actorRole` (8-й). Все существующие вызовы (cron auto-complete, route.ts:83-88) — без изменений. Defensive: при `actorRole === "CRON" && subscriptionId` → 422 INVALID_PAYMENT_COMBINATION (cron не имеет UI для выбора абонемента; защита от мисуса).

### A8: Anti-scope явно

В скоупе F7: 6 файлов на изменение + 8 на создание (см. ADR §8). Вне скоупа: schema.prisma (F6+F5 покрывают), shared payment-gate helper (YAGNI), refund/возврат часов, split-payment, notification гостю, изменения F6 service.ts (только потребляем helper).

---
