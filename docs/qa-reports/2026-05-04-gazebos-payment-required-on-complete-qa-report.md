# QA Report: F3 — Gazebos: запрет завершения брони без оплаты (iter2)

**RUN_ID**: `2026-05-04-gazebos-payment-required-on-complete`
**Branch**: `claude/wave-2-gazebos-subscriptions`
**HEAD**: `fb195f9` (fix commit, iter2)
**Дата**: 2026-05-04
**QA Engineer**: claude-sonnet-4-6

---

## Вердикт: PASS

---

## Прогон тестов

| Проверка | Результат |
|----------|-----------|
| `npm test -- --run` | 2124 / 2124 passed, 132 файлов |
| `npx tsc --noEmit` | 0 ошибок |

---

## Acceptance Criteria

| AC | Статус | Покрытие |
|----|--------|----------|
| AC-1 (gate — нет оплаты) | PASS | T1: cash=0,card=0 → `BookingError("PAYMENT_REQUIRED", ..., {shortfall:1500,totalBill:1500,paid:0})`; route → 422; `updateMany` NOT called; `financialTransaction.create` NOT called |
| AC-2 (gate — недоплата) | PASS | T2: cash=1000,card=0,totalBill=1500 → shortfall=500; `updateMany` NOT called |
| AC-3 (успешное завершение) | PASS | T3: cash+card=totalBill → `updateMany` + `financialTransaction.create(moduleSlug="gazebos", type=SESSION_PAYMENT, totalAmount=1500, cashAmount=1000, cardAmount=500)` + `auditLog.create(action="booking.complete")` |
| AC-4 (скидка 100%) | PASS | T4: discountPercent=100,discountReason="permanent_client" → totalBill=0, gate пропущен, FT(totalAmount=0), `auditLog.create` × 2 (booking.complete + booking.discount_applied) |
| AC-5 (нет тарифа) | PASS | T5: metadata.totalPrice="0.00" → totalBill=0, gate пропущен, FT(totalAmount=0,cashAmount=0,cardAmount=0) |
| AC-6 (race condition guard) | PASS | T6: `updateMany` возвращает count=0 → `BookingError("ALREADY_COMPLETED")`; route → 409; вторая FT не создаётся |
| AC-7 (форма с суммой) | PASS | `GazeboBillModal` рендерит два поля (cash/card), `effectiveTotal` отображается, cash=totalBill по умолчанию, card=0 по умолчанию |
| AC-8 (клиентская блокировка) | PASS | `disabled={confirming \|\| !discountValid \|\| isUnderpaid}` — кнопка активна при `cash+card >= totalBill`, в т.ч. при овerpayment (iter2 fix: `!isBalanced` убран) |
| AC-9 (ошибка сервера) | PASS | `data.error?.message` сохраняется в `apiError` state, передаётся prop в `GazeboBillModal`, рендерится как `<p role="alert">`, модалка не закрывается |

---

## Iter2 Fix — Проверка исправлений по замечаниям Reviewer

### BLOCKER (Issue 1): callers не передавали props → модалка открывалась с 0₽

`src/app/admin/gazebos/page.tsx:151-160` — ИСПРАВЛЕНО. `GazeboBookingActions` теперь получает:
- `totalPrice={Number((b.metadata as { totalPrice?: string | number })?.totalPrice ?? 0)}`
- `resourceName={gazeboName}`, `clientName={name}`, `date={toISODate(b.date)}`, `startTime={formatTime(b.startTime)}`, `endTime={formatTime(b.endTime)}`

`src/components/admin/gazebos/booking-list-mobile.tsx:94-102` — ИСПРАВЛЕНО. Аналогичный набор props. `GazeboMobileBookingRow` тип расширен `metadata?: unknown` для доступа к `totalPrice`. Импортирован `toISODate` из `@/lib/format`.

### MINOR (Issue 2): `!isBalanced` блокировал овerpayment, расходясь с T8

`src/components/admin/gazebos/gazebo-bill-modal.tsx:309` — ИСПРАВЛЕНО. Было:
```
disabled={confirming || !isBalanced || !discountValid || isUnderpaid}
```
Стало:
```
disabled={confirming || !discountValid || isUnderpaid}
```
`isBalanced` сохранён как информационный индикатор UX ("Сумма совпадает / Остаток не распределён"), не влияет на отправку. T8 (овerpayment) теперь консистентен с UI.

---

## Edge Cases

| Кейс | Статус |
|------|--------|
| T7: snapshot totalPrice используется, не пересчёт от pricePerHour | PASS — test asserts totalAmount=1800 при pricePerHour=500×4h=2000 |
| T8: овerpayment (cardAmount=2000 > totalBill=1500) | PASS — сервер принимает, FT создаётся с cashAmount=0,cardAmount=2000; UI разблокирован после iter2 |
| T9: CRON bypass даже при totalBill>0 | PASS — actorRole="CRON" пропускает gate, создаёт FT(totalAmount=1500,cashAmount=1500), auditLog(action="booking.auto_complete",metadata.actor="CRON") |

---

## Anti-scope (F1 не тронут)

Iter2 commit `fb195f9` изменяет ровно 5 файлов:
- `docs/context/...context.md` — документация
- `docs/qa-reports/...review.md` — ревью
- `src/app/admin/gazebos/page.tsx`
- `src/components/admin/gazebos/booking-list-mobile.tsx`
- `src/components/admin/gazebos/gazebo-bill-modal.tsx`

`src/modules/ps-park/`, `src/lib/api-response.ts`, `src/app/api/ps-park/`, `src/components/admin/ps-park/` — не тронуты. Scope creep отсутствует.

---

## API контракт (сравнение с F1)

`PAYMENT_REQUIRED` → 422 с `error.metadata = { shortfall, totalBill, paid }` — идентично F1 (`src/app/api/ps-park/bookings/[id]/route.ts`). `apiError(code, msg, 422, error.metadata)` — 4-й аргумент передаётся корректно. `ALREADY_COMPLETED` → 409. `INVALID_STATUS_TRANSITION` → 400.

---

## Backward Compatibility

`BookingError` класс (`service.ts:1140-1147`): опциональный 3-й аргумент `metadata?: Record<string, unknown>`. Все 14+ существующих `throw new BookingError(code, msg)` — без изменений, компилируются без ошибок. `updateBookingStatus` — новые параметры опциональны, `actorRole = "MANAGER"` по умолчанию.

---

## Race Guard

`updateMany WHERE id=bookingId AND status IN ["CONFIRMED", "CHECKED_IN"]` — идентично F1 (`ps-park/service.ts:475-487`). При count=0 → `BookingError("ALREADY_COMPLETED")` до вызова `financialTransaction.create`. Двойных FT-записей нет.

---

## Security

| Кейс | Статус |
|------|--------|
| Анонимный PATCH → 401 | PASS — `auth()` проверяется первым, `apiUnauthorized()` если нет сессии |
| USER пытается завершить бронь (MANAGER-only action) | PASS — `hasRole(session.user, "MANAGER")` guard, ветка CANCELLED доступна только USER для своей брони |
| MANAGER чужого модуля (не gazebos) → 403 | PASS — `requireAdminSection(session, "gazebos")` |
| `performedById` берётся из `session.user.id`, не из body | PASS — `session.user.id` в `route.ts:87` |
| SQL-инъекции | PASS — нет `$executeRawUnsafe`, Prisma параметризует |
| Secrets leakage | PASS — `FT.metadata` содержит только бизнес-данные |

Security verdict: PASS

---

## Итог

Все 9 AC проверены и проходят. Оба блокирующих замечания Reviewer (Issue 1 BLOCKER, Issue 2 MINOR) закрыты в commit `fb195f9`. Тесты 2124/2124, TSC чист. Scope строго ограничен F3, F1 не тронут.
