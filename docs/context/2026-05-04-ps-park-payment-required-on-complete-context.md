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

- [ ] PO — PRD
- [ ] Architect — ADR
- [ ] Developer — implementation
- [ ] Reviewer — audit
- [ ] QA — verify

---

## PO — Ключевые решения

(заполняется после Stage 1)

## Architect — Ключевые решения

(заполняется после Stage 2)

## Developer — Заметки реализации

(заполняется после Stage 3)

## Reviewer — Вердикт

(заполняется после Stage 4)

## QA — Вердикт

(заполняется после Stage 5)
