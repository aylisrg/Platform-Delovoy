# PRD: Gazebos — запрет завершения брони без оплаты (F3)

**Тикет**: F3  
**RUN_ID**: `2026-05-04-gazebos-payment-required-on-complete`  
**Branch**: `claude/fix-booking-session-closure-7SSOS`  
**Дата**: 2026-05-04  
**Зависимость**: F1 (PR #236, ps-park payment gate) — мерджен, не трогаем

---

## Проблема

Менеджер беседок сейчас может нажать «Завершить» на брони и перевести её в статус COMPLETED без ввода каких-либо денег. Никакой записи о выручке при этом не создаётся. Итог двоякий:

1. Деньги за аренду беседки могут не попасть в кассу — менеджер забыл, клиент не напомнил, инцидент не отслеживается.
2. Аналитика выручки по беседкам (Phase 5.3 dashboard) опирается на `FinancialTransaction`, которая для беседок не создаётся вообще. Цифры в отчётах — нулевые.

Заказчик сформулировал требование однозначно: «То же правило и на счёт беседок!» — имея в виду запрет завершения без оплаты, аналогичный уже работающему в PS Park (F1, PR #236).

---

## Решение

Перенести паттерн `PAYMENT_REQUIRED` gate из PS Park на модуль беседок без изменения F1. Менеджер при завершении брони обязан ввести сумму наличными и/или картой. Если сумма меньше стоимости брони — система отказывает с явной ошибкой и указывает недостачу. При успехе создаётся запись `FinancialTransaction` в финансовом журнале, как в PS Park.

UI «активной сессии» (таймер текущей сессии, как в PS Park) для беседок **не создаётся** — это отдельная задача, заказчиком в данной итерации не запрошенная.

---

## Целевая аудитория

**Прямой пользователь**: MANAGER беседок — меняется его рабочий процесс при завершении брони.  
**Выгодоприобретатель**: SUPERADMIN — видит корректные цифры выручки в отчётах и дашборде.

---

## Что уже есть (не делаем заново)

- `Booking.cashAmount`, `Booking.cardAmount` — поля уже в схеме (`prisma/schema.prisma:197-198`).
- `FinancialTransaction` — модель и `FinancialTxType.SESSION_PAYMENT` уже определены (`prisma/schema.prisma:247-265`).
- `BookingError` — класс ошибок уже есть (`src/modules/gazebos/service.ts:1052-1058`).
- Расчёт стоимости при бронировании — `computeGazeboPricing` уже работает (`src/modules/gazebos/pricing.ts:108-141`), записывает `totalPrice` в `Booking.metadata`.
- Логика скидок — `applyDiscount`, `getMaxDiscountPercent` уже импортированы в `src/modules/gazebos/service.ts:19`.
- CRON auto-complete для беседок — в кодовой базе не обнаружен. Guard `actorRole !== "CRON"` не обязателен, но параметр `actorRole` добавляется для симметрии с F1 и будущей расширяемости.

---

## User Stories

### US-1: Менеджер фиксирует оплату при завершении брони беседки

- **Как** менеджер беседок
- **Я хочу** при закрытии брони ввести сумму, полученную наличными и/или картой
- **Чтобы** каждый рубль за аренду беседки попадал в кассу и финансовый журнал

**Acceptance Criteria:**

- [ ] **AC-1 (gate — нет оплаты)**: При попытке завершить бронь с `cashAmount=0` и `cardAmount=0`, если расчётная стоимость брони больше нуля, API возвращает `422` с кодом `PAYMENT_REQUIRED`. Тело ответа содержит `error.details.shortfall`, `error.details.totalBill`, `error.details.paid`.
- [ ] **AC-2 (gate — недоплата)**: Если `cashAmount + cardAmount < totalBill` при любых ненулевых значениях, API возвращает `422` с кодом `PAYMENT_REQUIRED`. Поле `error.details.shortfall` содержит точную недостачу до копейки.
- [ ] **AC-3 (успешное завершение)**: Если `cashAmount + cardAmount >= totalBill`, бронь переходит в COMPLETED. В таблице `FinancialTransaction` создаётся запись: `moduleSlug="gazebos"`, `type=SESSION_PAYMENT`, `bookingId`, `totalAmount=totalBill` (после скидки), `cashAmount`, `cardAmount`, `performedById`. API возвращает `200`.
- [ ] **AC-4 (скидка 100%)**: Если применена скидка 100% с обязательной причиной, `totalBill` после скидки = 0. Завершение проходит без ввода оплаты. `FinancialTransaction` создаётся с `totalAmount=0`.
- [ ] **AC-5 (нет тарифа)**: Если у ресурса-беседки не задана цена (`pricePerHour=null`, `metadata.priceList` отсутствует), `totalBill=0`. Завершение проходит без ввода оплаты.
- [ ] **AC-6 (race condition guard)**: При повторном запросе завершения уже COMPLETED брони API возвращает `400` с кодом `ALREADY_COMPLETED`. Вторая запись `FinancialTransaction` не создаётся. Реализуется через `booking.updateMany` с фильтром `status: { in: ["CONFIRMED", "CHECKED_IN"] }` — образец `src/modules/ps-park/service.ts:475-487`.

### US-2: Менеджер видит форму оплаты при нажатии «Завершить»

- **Как** менеджер беседок
- **Я хочу** видеть поля «наличными» и «картой» перед финальным подтверждением завершения
- **Чтобы** ввод суммы был естественным шагом, а не неожиданным препятствием

**Acceptance Criteria:**

- [ ] **AC-7 (форма с суммой)**: При нажатии «Завершить» (когда `totalBill > 0`) в `booking-actions.tsx` открывается блок с двумя полями: «Наличные, ₽» (по умолчанию = `totalBill`) и «Карта, ₽» (по умолчанию = 0). Итоговая сумма к оплате отображается.
- [ ] **AC-8 (клиентская блокировка)**: Кнопка подтверждения неактивна, если `cashAmount + cardAmount < totalBill`. Это клиентская валидация, не заменяющая серверную.
- [ ] **AC-9 (отображение ошибки сервера)**: Если сервер вернул `422 PAYMENT_REQUIRED`, пользователь видит сообщение с суммой недостачи из `error.details.shortfall`.

---

## Затронутые файлы

| Файл | Изменение |
|------|-----------|
| `src/modules/gazebos/service.ts` (строки 363-583) | Расширить `updateBookingStatus`: параметры `cashAmount?`, `cardAmount?`, `actorRole?`; gate; `FinancialTransaction`; `updateMany` |
| `src/app/api/gazebos/bookings/[id]/route.ts` (строки 39-114) | Принимать `cashAmount`, `cardAmount` в PATCH; маппить `PAYMENT_REQUIRED` → 422 |
| `src/components/admin/gazebos/booking-actions.tsx` | Добавить форму с полями cash/card по образцу PS Park |
| `src/modules/gazebos/__tests__/service.test.ts` | Создать (если нет) или расширить: минимум 6 тест-кейсов (AC-1..AC-6) |

---

## Приоритет (MoSCoW)

**Must have** — заказчик прямо указал требование. Без него деньги за беседки выпадают из учёта при каждом завершении брони, аналитика выручки невозможна. Миграции БД не требуются — всё нужное уже в схеме.

**Зависимости:**
- F1 (PR #236) — мерджен, служит образцом; не изменяется
- `prisma/schema.prisma` — `cashAmount`/`cardAmount`/`FinancialTransaction` уже есть
- `src/modules/gazebos/pricing.ts` — уже считает `totalPrice` при создании брони

---

## Метрики успеха

**Базовое значение (до релиза):** все COMPLETED брони беседок имеют `cashAmount IS NULL`, записей `FinancialTransaction` с `moduleSlug='gazebos'` нет.

**Целевое значение (через 7 дней после релиза):**
```sql
SELECT count(*) FROM "Booking"
WHERE "moduleSlug" = 'gazebos'
  AND "status" = 'COMPLETED'
  AND ("cashAmount" + "cardAmount") = 0
  AND (
    "metadata"->>'discount' IS NULL
    OR (("metadata"->'discount'->>'percent')::int < 100)
  );
-- Должно возвращать 0
```

Дополнительно: `SELECT count(*) FROM "FinancialTransaction" WHERE "moduleSlug"='gazebos'` — должны появиться записи за каждую завершённую бронь.

---

## Открытые вопросы для Architect

1. **Shared helper**: выносить ли `assertPaymentSufficient(totalBill, cash, card, actorRole)` в `src/modules/booking/payment-gate.ts`? Теперь два потребителя (ps-park + gazebos). F1 не выделял (YAGNI). Architect решает.
2. **Откуда брать `totalBill` при checkout**: использовать `metadata.totalPrice` (снэпшот на момент создания) или пересчитывать по факту — `pricePerHour × billedHours(startTime, now)`? PS Park пересчитывает по фактическому времени (`src/modules/ps-park/service.ts:314-316`). Беседки платят за забронированный слот — может быть иная логика.
3. **Округление billedHours**: если принято пересчитывать, то с шагом 15 минут (как PS Park) или иначе?
4. **`BookingError` vs отдельный класс**: существующий `BookingError` (`src/modules/gazebos/service.ts:1052`) не принимает `details`. Достаточно ли добавить необязательный третий аргумент `details?: Record<string, unknown>` или создать `GazeboBookingError` по образцу `PSBookingError`?
5. **`FinancialTransaction` в существующих отчётах**: убедиться, что агрегации в `analytics` и `rental/reports` корректно обрабатывают `moduleSlug="gazebos"` и не ломают существующие итоги.

---

## Вне скоупа

- UI «активной сессии» беседок (таймер, статус CHECKED_IN) — отдельная фича, не запрошена.
- Инвентарные позиции (items) в счёте при checkout — газебо не работает с goods-checkout как PS Park; `itemsTotal` учитывается только если записан в `metadata` при создании.
- Выделение `computeGazeboPricing` в shared pricing-сервис — не нужно.
- Изменение F1 (ps-park) — не трогаем.
- Онлайн-оплата клиентом (эквайринг) и возвраты — не в этой итерации.
- Изменение схемы БД — не требуется.

---

## Чеклист перед передачей Architect

- [x] Проблема описана и понятна без дополнительного контекста
- [x] Целевая аудитория определена (MANAGER — прямой пользователь, SUPERADMIN — выгодоприобретатель)
- [x] Все user stories содержат роль, действие и ценность
- [x] У каждой story есть проверяемые acceptance criteria (9 AC с кодами и числами)
- [x] Приоритет обоснован по MoSCoW
- [x] Метрики успеха определены (базовое + целевое значение с SQL-запросами)
- [x] Секция "Вне скоупа" заполнена
- [x] Проверено, что функционал не дублирует существующий (F1 в ps-park уже закрывает тот же вопрос для другого модуля)
- [x] Открытые технические вопросы вынесены в раздел для Architect
