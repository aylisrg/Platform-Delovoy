# QA Report F1 — verdict: PASS

**RUN_ID**: `2026-05-04-ps-park-payment-required-on-complete`
**Branch**: `claude/fix-booking-session-closure-7SSOS`
**Date**: 2026-05-04
**QA Iteration**: 1

---

## Test execution

| Проверка | Результат | Детали |
|----------|-----------|--------|
| `npm test` | PASS | 131 files / **2083 passed / 0 failed** |
| `npx tsc --noEmit` | PASS | 0 errors |
| Время прогона тестов | 12.14s | transform 3.74s, tests 3.44s |
| PS Park tests | PASS | 70 passed в `service.test.ts` |

---

## AC verification

| AC | Status | Test / code reference | Notes |
|----|--------|-----------------------|-------|
| AC-1: cash=0, card=0, no discount → 422 PAYMENT_REQUIRED, статус не меняется, FT не создаётся | PASS | T1, `service.test.ts:312` — проверяет `code === "PAYMENT_REQUIRED"`, `metadata.shortfall===300`, `updateMany NOT called`, `financialTransaction.create NOT called` | Полное покрытие |
| AC-2: частичная оплата (cash=300, totalBill=500) → 422, shortfall=200 | PASS | T2, `service.test.ts:326` — `metadata.shortfall===200`, `updateMany NOT called` | |
| AC-3: cash+card === totalBill → 200, FT(totalAmount=500, cash=300, card=200) | PASS | T3, `service.test.ts:339` — `financialTransaction.create` с точными суммами | |
| AC-4: 100%-скидка, discountReason="permanent_client", cash=0, card=0 → успех, FT(0), 2× AuditLog | PASS с оговоркой | T4, `service.test.ts:364` — `financialTransaction.create` с `totalAmount=0`, `auditLog.create` вызван 2 раза | **Расхождение с PRD** (см. ниже) |
| AC-5: UI блокирует submit при discountReason пуст / < 3 символов | PASS (N/A unit) | `session-bill-modal.tsx:110-115` — `discountValid` = false при `discountReason === ""` или `discountReason === "other" && discountNote.length < 5`; `disabled` включает `!discountValid` (строка 386) | UI-уровень, unit-тестом не покрыт по ADR §6.3 — корректно |
| AC-6: cardAmount > totalBill (переплата) → успех, FT с реальными суммами | PASS | T6, `service.test.ts:394` — `financialTransaction.create` с `cashAmount=0, cardAmount=600` | |
| AC-7: totalBill=0 (нет тарифа) → успех без требования оплаты, FT(0) | PASS | T7, `service.test.ts:417` — `pricePerHour=0`, FT создаётся с `totalAmount=0`, `PAYMENT_REQUIRED` не бросается | |
| AC-8: race condition → только один writer получает count>0, второй → ALREADY_COMPLETED | PASS | `service.test.ts:240` — существующий тест; gate срабатывает ДО `updateMany`, при PAYMENT_REQUIRED `updateMany` не вызывается (T1, T2); race guard `status: { in: ["CONFIRMED", "CHECKED_IN"] }` сохранён в `service.ts:372` | |

### Расхождение AC-4: audit log action names

PRD §AC-4 указывает `AuditLog.action = "session.complete.full_discount"`. Реализация использует **два** отдельных audit log: `"session.complete"` + `"booking.discount_applied"`. Это расхождение было зафиксировано в context-log (Reviewer подтвердил) и явно описано в ADR §8. Выбор Developer'а является **валидным реализационным решением**: два отдельных action дают более гранулярный audit trail и соответствуют существующему паттерну в сервисе. T4 (`auditLog.create` вызван ровно 2 раза) подтверждает корректность. Вердикт по AC-4: PASS с аннотацией.

---

## Edge cases

| Case | Status | Reference |
|------|--------|-----------|
| totalBill=0 (нет тарифа, нет items) | PASS | T7, `service.ts:445` — gate `completedTotalBill > 0` → пропускается |
| discountPercent > 100 | PASS (pre-existing) | Zod `max(100)` в `checkoutDiscountSchema` — заблокировано на уровне route handler до вызова сервиса |
| cardAmount > totalBill (переплата) | PASS | T6 — gate `paidByOperator < completedTotalBill` → false при переплате, запрос проходит |
| actorRole=CRON → bypass gate | PASS | T9, `service.test.ts:441` — `actorRole !== "CRON"` исключает CRON из gate, `auditLog.action === "session.auto_complete"` с `metadata.actor === "CRON"` |

---

## Quality checks

| Критерий | Статус | Детали |
|----------|--------|--------|
| TypeScript strict | PASS | `npx tsc --noEmit` — 0 ошибок |
| No `any` / `@ts-ignore` / `console.log` в изменённых файлах | PASS | Grep по всем 5 изменённым src-файлам — ничего не найдено |
| Backward compat `apiError` (4-й параметр опционален) | PASS | `api-response.ts:38` — `metadata?: Record<string, unknown>`. 290 существующих вызовов не сломаны (tsc clean) |
| Backward compat `PSBookingError` (3-й параметр опционален) | PASS | `service.ts:1811` — `metadata?: Record<string, unknown>`. Все существующие `throw new PSBookingError(code, msg)` без 3-го аргумента продолжают компилироваться |
| Scope (нет изменений schema/state-machine/gazebos/cafe/clients/inventory) | PASS | `git diff main...HEAD --stat` — изменены только: `service.ts`, `route.ts`, `api-response.ts`, `session-bill-modal.tsx`, `complete-session-button.tsx`, `service.test.ts` + docs + `package-lock.json` |
| package-lock.json изменение | PASS (N/A) | Только transitive optional/peer deps (`magicast@0.3.5`, `typescript@5.9.3` для `vite-tsconfig-paths`) — `package.json` не изменён, новых прямых зависимостей нет |
| RBAC не ослаблен | PASS | `route.ts:44-67` — `auth()`, `requireAdminSection(session, "ps-park")`, `hasRole(session.user, "MANAGER")` без изменений; новых endpoints не добавлено |
| API контракт (HTTP 422 + структура ответа) | PASS | `route.ts:125-134` — `unprocessableCodes` Set с `PAYMENT_REQUIRED` → 422; `apiError(error.code, error.message, 422, error.metadata)` → `{ success: false, error: { code, message, metadata: { shortfall, totalBill, paid } } }` |
| Документация (комментарий с ADR ссылкой) | PASS | `service.ts:442-444` — `// PAYMENT_REQUIRED gate — see ADR 2026-05-04-ps-park-payment-required-on-complete` |
| Conventional commit | PASS | `feat(ps-park): block COMPLETED transition without sufficient payment` |
| UI defense in depth | PASS | `session-bill-modal.tsx:72` — `isUnderpaid = effectiveTotal > 0 && cash + card < effectiveTotal`; `disabled={confirming || !isBalanced || !discountValid || isUnderpaid}` (строка 386); `role="alert"` на inline-ошибке (строка 369) |
| Модалка остаётся открытой при ошибке API | PASS | `complete-session-button.tsx:61-66` — `setBill(null)` только при `data.success`; при ошибке `bill` сохраняется, `apiError={error}` передаётся в `SessionBillModal` |

---

## RBAC / Security checks

| Кейс | Статус | Детали |
|------|--------|--------|
| Анонимный PATCH → 401 | PASS | `route.ts:45` — `if (!session?.user?.id) return apiUnauthorized()` |
| USER пытается завершить сессию (не свою отмену) → 403 | PASS | `route.ts:89-91` — ветка `else` при отсутствии MANAGER-роли → `apiError("FORBIDDEN", ..., 403)` |
| MANAGER без доступа к ps-park → 403 | PASS | `route.ts:66-67` — `requireAdminSection(session, "ps-park")` |
| metadata в ошибке не содержит PII | PASS | `{ shortfall: number, totalBill: number, paid: number }` — только числа, без userId/email/phone/INN |
| Прямой PATCH с cash=0/card=0 в обход UI | PASS | Gate в сервисном слое (`service.ts:445-456`) блокирует на уровне бизнес-логики независимо от UI |

---

## Bugs found

Баги не обнаружены.

---

## Замечания (не баги)

1. **discountReason минимальная длина**: PRD §AC-4 говорит "≥ 3 символов", но `discountValid` в `session-bill-modal.tsx:114` требует `discountNote.length >= 5` только для `discountReason === "other"`. Для всех остальных enum-значений (`DISCOUNT_REASONS`) длина не проверяется, т.к. они предопределены и заведомо корректны. Это допустимо и не является багом.

2. **T7 setup**: `mockTable({ pricePerHour: 0 })` — стол с `pricePerHour = 0` технически отличается от стола с `pricePerHour = null`. В реальной БД нулевой тариф может существовать (бесплатный стол), тогда как `null` — отсутствие тарифа. Обе ситуации дают `totalBill = 0`, и gate корректно пропускает обе. Тест покрывает суть AC-7, хотя мог бы использовать `null` для большей реалистичности.

---

## Decision

**PASS — ready to merge into main.**

Все 8 AC из PRD покрыты тестами и реализацией. Расхождение в naming audit log action для AC-4 (`"session.complete.full_discount"` в PRD vs `"session.complete" + "booking.discount_applied"` в коде) является задокументированным реализационным решением, принятым Architect'ом и Reviewer'ом. Scope creep отсутствует. TypeScript clean. 2083 тестов — 0 failures.
