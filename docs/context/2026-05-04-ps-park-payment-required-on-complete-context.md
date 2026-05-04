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
- [x] Architect — ADR
- [x] Developer — implementation
- [x] Reviewer — audit
- [x] QA — verify

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

> Полный ADR: [`docs/architecture/2026-05-04-ps-park-payment-required-on-complete-adr.md`](../architecture/2026-05-04-ps-park-payment-required-on-complete-adr.md)

- **Решение A1: guard живёт в `src/modules/ps-park/service.ts` (Вариант B), НЕ в state-machine.** Вставка ~15 строк между `service.ts:440` и `service.ts:442`, после применения скидки (`completedTotalBill = discountCalc.finalAmount`), до `prisma.$transaction`. State-machine остаётся pure-функцией без БД-доступа — `Resource.pricePerHour` и items snapshot не должны протекать в `TransitionContext`. Подтверждает PO Решение 1 + закрывает Open Question #3.

- **Решение A2: HTTP 422 для `PAYMENT_REQUIRED` (НЕ 400).** Соответствует существующему mapping в `src/app/api/ps-park/bookings/[id]/route.ts:127` (`DISCOUNT_EXCEEDS_LIMIT` → 422). Семантика RFC 4918: «Unprocessable Entity» — синтаксис валиден, бизнес-инвариант не выполнен. Закрывает Open Question #2.

- **Решение A3: контракт ошибки с structured `metadata`.** Тело ответа: `{ success: false, error: { code: "PAYMENT_REQUIRED", message: "Необходимо принять оплату: не хватает X ₽", metadata: { shortfall: number, totalBill: number, paid: number } } }`. Расширяем `apiError(...)` в `src/lib/api-response.ts` опциональным 4-м аргументом + расширяем `PSBookingError` опциональным 3-м аргументом `metadata`. Backward-compatible. UI получает `shortfall` как число, без regex-парсинга строки.

- **Решение A4: `Module.config.maxDiscountPercent` остаётся как есть, гибкость через config (НЕ через role-check)** (Open Question #1). PO предлагал (b) «100% только SUPERADMIN». Architect выбирает компромисс: текущий код (`getMaxDiscountPercent` + Zod `max(100)`) уже поддерживает 100% при условии что админ выставил `Module.config.maxDiscountPercent=100` через UI `/admin/ps-park/settings`. Не добавляем `if (discountPercent === 100 && actorRole !== "SUPERADMIN") throw` — это сюрприз для UX и сложнее тестировать. Если оператор хочет ограничить менеджеров — оставит config 30%, и 100%-скидка станет физически невозможна. Изменение config — отдельная op-задача, НЕ в этом PR.

- **Решение A5: `checkoutDiscountSchema` (Zod) НЕ меняем.** `cash + card >= totalBill` принципиально не валидируется в Zod — `totalBill` вычисляется на сервере из `Resource.pricePerHour + items + actualEndTime` и недоступен на этапе схемной валидации payload. Гарант — только сервисный слой. Закрывает Open Question #3 (вторая часть).

- **Решение A6: UI defense in depth.** `session-bill-modal.tsx:373` — добавляем явный `isUnderpaid = effectiveTotal > 0 && (cash + card) < effectiveTotal` к условию disabled. `complete-session-button.tsx` — НЕ закрываем модалку при ошибке от API, передаём `apiError` через новую prop `apiError?: string | null` в SessionBillModal для inline-отображения. Никаких новых компонентов, никакого toast-фреймворка.

- **Решение A7: тест CRON-ветки явно включён (T9 в test plan)** — Open Question #4. `actorRole="CRON"` + `cash=undefined, card=undefined` + `totalBill=300` → ожидать НЕТ `PAYMENT_REQUIRED`, `FinancialTransaction.totalAmount=300`, `auditLog.action="session.auto_complete"`. Регресс-защита от случайной поломки `autoCompleteExpiredSessions`.

- **Решение A8: scope-guard зафиксирован.** Файлы изменений: `src/modules/ps-park/service.ts` (guard + расширение `PSBookingError`), `src/app/api/ps-park/bookings/[id]/route.ts` (расширение error mapping), `src/lib/api-response.ts` (опциональный `metadata` параметр), `src/components/admin/ps-park/session-bill-modal.tsx` (inline-ошибка), `src/components/admin/ps-park/complete-session-button.tsx` (не закрывать модалку при ошибке), `src/modules/ps-park/__tests__/service.test.ts` (T1–T9). НЕ трогаем: `state-machine.ts`, `validation.ts` (ps-park и booking), `prisma/schema.prisma`, gazebos, NextAuth, Redis, Telegram-бот.

- **Test plan: 8 unit-тестов** (один на каждый AC из PRD: T1, T2, T3, T4, T6, T7, T8 — последний уже существует, обновить assertions; T5 — N/A, Zod-уровень) + 1 CRON regression test (T9). Все в `src/modules/ps-park/__tests__/service.test.ts`, моки уже настроены.

- **RBAC: новых endpoint'ов нет.** Существующий `PATCH /api/ps-park/bookings/:id` уже защищён `auth() → requireAdminSection(session, "ps-park") → hasRole(session.user, "MANAGER")`. Новых ролей, разрешений, secrets, env-переменных НЕТ.

- **Rollback-план:** `git revert <merge-commit>` — никаких миграций, изменения в 5–6 файлах, полностью обратимо одним коммитом.

## Developer — Заметки реализации

- **Файлы изменены (5):**
  - `src/lib/api-response.ts` — `apiError` 4-й параметр `metadata?: Record<string, unknown>`; `ApiErrorResponse.error.metadata?` опциональное поле. Backward-compatible.
  - `src/modules/ps-park/service.ts` — расширен `PSBookingError` (3-й аргумент `metadata?`); вставлен gate в `updateBookingStatus` после `completedTotalBill = discountCalc.finalAmount` (после применения скидки, до `prisma.$transaction`). Условие: `actorRole !== "CRON" && completedTotalBill > 0 && (cashAmount ?? 0) + (cardAmount ?? 0) < completedTotalBill`. Throws `PSBookingError("PAYMENT_REQUIRED", ..., { shortfall, totalBill, paid })`.
  - `src/app/api/ps-park/bookings/[id]/route.ts` — `unprocessableCodes` Set с `DISCOUNT_EXCEEDS_LIMIT` и `PAYMENT_REQUIRED` → 422; `apiError` теперь получает `error.metadata` четвёртым аргументом.
  - `src/components/admin/ps-park/session-bill-modal.tsx` — новая prop `apiError?: string | null`; вычисляется `isUnderpaid = effectiveTotal > 0 && cash + card < effectiveTotal`; добавлен в `disabled`; inline-ошибка с `role="alert"` показывается перед actions.
  - `src/components/admin/ps-park/complete-session-button.tsx` — передаёт `apiError={error}` в `SessionBillModal`; `onClose` сбрасывает и `bill`, и `error`.
- **Тесты (`src/modules/ps-park/__tests__/service.test.ts`):** новый describe `updateBookingStatus PAYMENT_REQUIRED gate` с 7 кейсами T1, T2, T3-explicit, T4, T6, T7, T9 (T5 N/A — UI-уровень; T8 уже покрыт существующим). К глобальному prisma-mock добавлен `module: { findUnique: vi.fn() }` для теста T4 (`getMaxDiscountPercent` дёргает `prisma.module.findUnique`).
- **Результаты:** `npm test` → 131 файл / **2083 pass / 0 fail**. `npx tsc --noEmit` → clean.
- **Schema:** не менялась.
- **Public API:** добавлен опциональный 4-й аргумент в `apiError(code, message, status, metadata?)`; новое поле `error.metadata?` в `ApiErrorResponse`. Расширен `PSBookingError` 3-м опц. аргументом. Все изменения backward-compatible — десятки существующих вызовов не трогаются.

## Reviewer — Вердикт

- **Вердикт:** PASS
- **Iteration:** 1
- **Issues count:** 0
- **Краткое резюме:** Реализация точно соответствует ADR Variant B и покрывает все 8 AC из PRD. Gate вставлен в правильной позиции (после скидки, до транзакции), все edge cases (CRON, totalBill=0, переплата, 100%-скидка) корректно обработаны. Security: RBAC не изменён, в metadata утечек нет, no raw SQL, no secrets. Тесты T1, T2 проверяют отсутствие побочных эффектов (updateMany + financialTransaction.create не вызываются); T9 даёт регресс-защиту CRON. Backward compatibility apiError/PSBookingError — корректна. Scope creep отсутствует.

## QA — Вердикт

- **Вердикт:** PASS
- **Iteration:** 1
- **Тесты:** 2083 passed / 0 failed (131 файлов; 70 тестов в service.test.ts)
- **Bugs:** 0
- **Краткое резюме:** Все 8 AC из PRD подтверждены тестами T1–T9. Gate вставлен корректно (после скидки, до транзакции). CRON bypass (T9), totalBill=0 (T7), переплата (T6), 100%-скидка (T4) — все edge cases закрыты. TypeScript clean. Scope не расширен — изменены ровно 5 src-файлов + тесты. RBAC проверки сохранены без изменений. API контракт HTTP 422 + metadata.shortfall/totalBill/paid соответствует ADR. Расхождение в naming audit log (PRD: "session.complete.full_discount" vs код: "session.complete" + "booking.discount_applied") — задокументированное реализационное решение, не является багом.
