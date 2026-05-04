# Context Log — 2026-05-04 — F1: PS Park, запретить завершение сессии без оплаты

> RUN_ID: `2026-05-04-ps-park-payment-required-on-complete`
> Branch: `claude/fix-booking-session-closure-7SSOS`
> Wave 1 / 4 (план: `/root/.claude/plans/flickering-sauteeing-acorn.md`)

## Задача

Менеджер не должен иметь возможности перевести PS Park-сессию в `COMPLETED` без получения оплаты (`cashAmount + cardAmount + discountAmount >= totalBill`). 100%-скидка («за счёт заведения») допускается, но только при непустом `discountReason`. Беседки и другие модули — отдельные тикеты (F3+).

## Acceptance Criteria (краткий резерв)

1. PATCH с `cash=0, card=0, no discount` → 400 `PAYMENT_REQUIRED`, бронь остаётся `CHECKED_IN`.
2. Недоплата → 400 `PAYMENT_INSUFFICIENT`.
3. 100%-скидка с `discountReason.length >= 3` → разрешено, FinancialTransaction(0) + AuditLog `session.complete.full_discount`.
4. `getBookingBill` — единственный источник totalBill.
5. UI complete-session-button + session-bill-modal: inline-ошибка, кнопка disabled при недоплате.
6. Unit-тесты state-machine: 5 кейсов.
7. Race-condition guard `updateMany WHERE status IN […]` сохранён.
8. Scope: только PS Park.

## Затронутые файлы

- `src/modules/booking/state-machine.ts`
- `src/modules/ps-park/service.ts`
- `src/components/admin/ps-park/session-bill-modal.tsx`
- `src/components/admin/ps-park/complete-session-button.tsx`
- `src/modules/booking/__tests__/state-machine.test.ts`

## Stages

- [x] PO — PRD
- [ ] Architect — ADR
- [ ] Developer — implementation
- [ ] Reviewer — audit
- [ ] QA — verify

---

## PO — Ключевые решения

- **Решение 1: gate — только в сервисном слое, не в UI.** Проверка `PAYMENT_REQUIRED` реализуется в `updateBookingStatus` (`src/modules/ps-park/service.ts`), а не только в `session-bill-modal.tsx`. UI-блокировка `isBalanced` — первый рубеж (UX), серверная проверка — второй (защита от прямых PATCH-запросов в обход интерфейса). Оба уровня обязательны.

- **Решение 2: CRON-завершение исключено из payment-gate.** `autoCompleteExpiredSessions` завершает зависшие сессии без оплаты (`cash = 0, card = 0`, `actorRole = "CRON"`). Блокировать CRON означало бы навечно оставлять столы занятыми при недосмотре менеджера. Reconciliation по `AuditLog.action = "session.auto_complete"` (уже существует, строка ~494 service.ts) достаточен для аудита. Architect должен убедиться, что gate ветвится по `actorRole !== "CRON"`.

- **Решение 3: totalBill = 0 — оплата не требуется.** Техническая бронь без тарифа (`pricePerHour = null`) и без items даёт `completedTotalBill = 0`. Для неё payment-gate не применяется. Условие: `if (completedTotalBill > 0 && resolvedCash + resolvedCard < completedTotalBill) → PAYMENT_REQUIRED`.

- **Решение 4: переплата разрешена.** `cardAmount > totalBill` (сдача выдаётся наличными) — допустимый сценарий. API принимает запрос и записывает реально введённые суммы. Поведение остаётся прежним.

- **Решение 5: 100%-скидка — единственный легальный способ закрыть без фактической оплаты.** Если сессия обслуживается бесплатно, менеджер применяет скидку 100% с обязательным `discountReason` (мин. 3 символа). `effectiveTotal` становится 0, gate пропускает. В `AuditLog` остаётся полная цепочка: `session.complete` + `booking.discount_applied`. «Тихое» закрытие на нулевую сумму без скидки более невозможно.

- **Решение 6: схема Prisma не меняется.** Никаких новых полей в `Booking` или новых моделей. Все необходимые данные присутствуют: `cashAmount`/`cardAmount` в `Booking`; `totalAmount`/`cashAmount`/`cardAmount` в `FinancialTransaction`; `discountReason` в `AuditLog.metadata`.

- **Open questions для Architect:**
  - **maxDiscountPercent vs. 100%-скидка.** Текущий лимит из `/api/ps-park/settings` — 30% по умолчанию. Сценарий «закрыть бесплатно» требует 100%, что превышает лимит. Варианты: (a) добавить `allowFullDiscount: boolean` в `Module.config`; (b) разрешить 100% только SUPERADMIN, MANAGER ограничен `maxDiscountPercent`; (c) 100% доступна любому MANAGER при наличии причины. PO рекомендует вариант (b) — наименее рискован, схема не меняется.
  - **HTTP-статус и тело ошибки.** PRD предлагает `422 PAYMENT_REQUIRED`. Architect подтверждает статус-код и определяет точный формат `error.metadata` (нужно ли включать `shortfall` в рублях), чтобы `complete-session-button.tsx` мог отобразить разницу без парсинга строки.
  - **Zod-схема.** Проверку `cash + card >= totalBill` нельзя выразить в Zod без знания серверного `totalBill` — она остаётся только в сервисе. Architect подтверждает.
  - **Тест CRON без оплаты.** Unit-тест `autoCompleteExpiredSessions` с `actorRole = "CRON"` должен подтвердить отсутствие `PAYMENT_REQUIRED`. Architect включает в тест-план.

## Architect — Ключевые решения

(заполняется после Stage 2)

## Developer — Заметки реализации

(заполняется после Stage 3)

## Reviewer — Вердикт

(заполняется после Stage 4)

## QA — Вердикт

(заполняется после Stage 5)
