# QA: Issue #478 — NO_SHOW → CHECKED_IN проверяет занятость слота (gazebos + ps-park)

## Вердикт: PASS

Branch: `claude/issue-478-noshow-checkin-conflict`, commit `3d1cf82` (single commit,
`fix(booking): NO_SHOW → CHECKED_IN проверяет занятость слота`, `Closes #478`), diff vs `main`.
Verified independently from the code-review PASS (`docs/qa-reports/2026-08-13-issue-478-noshow-checkin-conflict-review.md`)
by re-reading the diff, tracing the code by hand and re-running the gates myself — not just re-reading
the reviewer's conclusions.

---

## Regression / build gates

| Check | Result |
|-------|--------|
| `npm test -- --run` | **209 test files / 3133 tests, all passing** |
| `npx tsc --noEmit` | Clean, no output, no errors |
| `npm run lint` | 0 errors, 15 pre-existing warnings — all in unrelated files (`messenger/*`, `notifications/service.ts`, `telephony/novofon-client.ts`); none of the 5 files touched by this diff appear in the warning list |
| Targeted re-run: `src/modules/gazebos/__tests__/service.test.ts src/modules/ps-park/__tests__/service.test.ts` | 2 files, all passing |

---

## Acceptance criteria table (per issue #478's "Тесты" section)

| # | AC | Verdict | Evidence |
|---|---|---|---|
| 1 | `NO_SHOW → CHECKED_IN` на свободный слот проходит (регрессия на существующую фичу позднего заезда, `lateCheckedInAt`) | PASS | `gazebos/service.ts:1238-1281` — early `if (!isFromNoShow)` returns the plain `update` unchanged; the `isFromNoShow` branch wraps `lockSlot` + conflict-check + `tx.booking.update` in `prisma.$transaction`. Test `"проходит на свободный слот (регрессия на фичу позднего заезда)"` (gazebos) mocks the second `findFirst` (inside the tx) as `null` (free slot) and asserts `prisma.$transaction`/`txExecuteRaw` were called and `prisma.booking.update` was called with `status: "CHECKED_IN"`. ps-park's existing test `"transitions NO_SHOW → CHECKED_IN (late arrival), stores lateCheckedInAt"` was correctly updated to the new two-step `findFirst` sequence (booking, then `null` under lock) rather than left as a single `mockResolvedValue` that would silently short-circuit the new code path. `newMetadata` logic (`lateCheckedInAt`/`checkedInBy`) is untouched by the diff — still built before the branch, so the late-arrival field is preserved in both branches. |
| 2 | `NO_SHOW → CHECKED_IN` на занятый слот отдаёт `BOOKING_CONFLICT` и не меняет статус брони | PASS | Conflict path: `tx.booking.findFirst` (moduleSlug + `deletedAt: null` (gazebos) + `resourceId` + `id: { not: bookingId }` + `status: { in: ACTIVE_BOOKING_STATUSES }` + date/time overlap) → `throw new BookingError/PSBookingError("BOOKING_CONFLICT", ...)` before `tx.booking.update` is ever called. Both modules' new test `"отдаёт BOOKING_CONFLICT и не меняет статус, если слот уже занят другой бронью"` asserts **both** `rejects.toMatchObject({ code: "BOOKING_CONFLICT" })` **and** `expect(prisma.booking.update).not.toHaveBeenCalled()` — exactly the double-assertion the task asked me to verify, so the test genuinely distinguishes "failed with conflict" from "failed for some other reason but also didn't update." Traced by hand: with the conflict mocked, the `if (conflict) throw ...` statement executes before the `return tx.booking.update(...)` statement is reached in the same function body — this is a real code branch, not something the test infers indirectly. |
| 3 | `CONFIRMED → CHECKED_IN` не сломан и лишней блокировки слота не берёт | PASS | Traced by hand, not just via the test: `checkInBooking()` computes `isFromNoShow = booking.status === "NO_SHOW"` once (line 1233/1063), then `if (!isFromNoShow) { return prisma.booking.update(...); }` returns immediately — the function body never reaches the `prisma.$transaction(...)` call for a `CONFIRMED` booking; it's a genuine early return on a different code path, not merely an absent assertion. Both modules' new test `"CONFIRMED → CHECKED_IN не берёт лишней блокировки слота (уже занимал его)"` confirms `expect(prisma.$transaction).not.toHaveBeenCalled()` with a `CONFIRMED` booking and a `startTime` 10 minutes in the past (satisfying `assertValidTransition`'s `now >= startTime` requirement for this transition per `state-machine.ts:66-69`), so the test actually reaches the code under test rather than failing earlier on an unrelated transition-guard rejection. |

### Mock fidelity check (why these tests actually exercise production code)
Read the `$transaction` mock setup in both test files (`gazebos/__tests__/service.test.ts:67-82`,
equivalent in `ps-park`): the mock's `tx` object aliases `tx.booking` to the same top-level
`prisma.booking` mock (`tx: { booking: p.booking, ... }`), so `.mockResolvedValueOnce(...)` chains
against `prisma.booking.findFirst` genuinely drive both the outer (`findFirst` for the booking
itself) and inner (`tx.booking.findFirst` for the conflict-check, executed inside the mocked
transaction callback) calls in sequence. This isn't a stub that always resolves the same value
regardless of what's inside the transaction — I confirmed the mock actually invokes the callback
(`return fn(tx)`), so the real `checkInBooking` transaction body runs under test, not a bypassed
shortcut.

---

## Independent findings beyond re-confirming the review

- **`ACTIVE_BOOKING_STATUSES`** (`PENDING`, `CONFIRMED`, `CHECKED_IN`) correctly excludes `NO_SHOW`,
  matching the issue's premise that NO_SHOW legitimately frees the slot — confirmed by reading
  `state-machine.ts:29`, not assumed from the diff alone.
- **`lockSlot` usage matches its own doc-comment contract exactly** (`slot-lock.ts:29-46`): "Вызов
  обязан быть первым стейтментом транзакции" — verified `lockSlot(tx, ...)` is line 1 of both
  transaction callbacks, before the conflict `findFirst`. No external/network call occurs inside
  either transaction (only `tx.booking.findFirst`/`tx.booking.update`), consistent with the
  doc-comment's warning against holding the advisory lock across network I/O.
- **`state-machine.ts` comment update is truthful**: previously documented the exact hole this PR
  closes ("не перепроверяет занятость... трекается в #478"); now describes the fix accurately and
  doesn't contradict the code. No stale/misleading comment left behind.
- **Would these tests have failed against the pre-fix code?** Yes, confirmed by re-reading the old
  code in the diff's `-` lines: pre-fix, `isFromNoShow` never triggered `prisma.$transaction` at
  all (a bare `prisma.booking.update` for every status), so (a) the conflict test's second
  `findFirst` mock would go unused and `checkInBooking` would resolve instead of rejecting with
  `BOOKING_CONFLICT`, failing the `rejects.toMatchObject` assertion, and (b) the free-slot test's
  `expect(prisma.$transaction).toHaveBeenCalled()` assertion would fail outright. These are genuine
  regression guards, not tautological tests that would pass either way.
- **Out-of-scope, already tracked (#512, per task brief)**: `ps-park/service.ts:1038-1039`'s initial
  `findFirst` (finding the booking itself) doesn't filter `deletedAt: null`, unlike
  `gazebos/service.ts:1209-1211` which does. Confirmed this asymmetry is real by reading both files
  side by side. Not introduced or touched by this diff, correctly out of scope for #478, not a
  blocker for this PASS.

---

## Security functional checks (relevant subset)

- **RBAC**: routes (`src/app/api/gazebos/bookings/[id]/checkin/route.ts`,
  `src/app/api/ps-park/bookings/[id]/checkin/route.ts`) are unchanged (not in the diff) — confirmed
  by `git diff --stat` showing only 5 files, neither route among them. `managerId` is still sourced
  from `session.user.id`, never from request body/params — no new "act as another user" surface
  introduced by this fix.
- **Error propagation**: `BOOKING_CONFLICT` thrown inside `prisma.$transaction` propagates out of
  the transaction as a normal rejected promise (Prisma re-throws non-Prisma errors thrown inside the
  callback unchanged) and is caught by the existing route `catch` block, returned via
  `apiError(error.code, error.message)` — not swallowed into a generic 500, not leaking a stack
  trace or internal transaction detail to the client.
- **Injection**: only Prisma query builder (`tx.booking.findFirst`/`update`) plus the existing,
  untouched `lockSlot()` (parameterized via `Prisma.sql` builder, not string concatenation) — no new
  raw SQL introduced by this diff.
- **Data leakage**: no new fields returned to the client; conflict error message is a static string
  with no guest PII (name/phone/email) of the conflicting booking.
- **Audit log**: `logAudit(..., "booking.checkin", ...)` in both routes still only fires after a
  successful `checkInBooking()` resolves — a rejected `BOOKING_CONFLICT` attempt correctly does not
  write a spurious success audit entry.

No security-case FAIL found for the changes in this diff.

---

## Scope check

- 5 files changed: `src/modules/gazebos/service.ts`, `src/modules/gazebos/__tests__/service.test.ts`,
  `src/modules/ps-park/service.ts`, `src/modules/ps-park/__tests__/service.test.ts`,
  `src/modules/booking/state-machine.ts` (doc-comment only). No new module, no unrelated refactor,
  no `package.json` changes. Matches the issue's prescribed fix (reuse of the existing `lockSlot`
  pattern from #429) with no scope creep.

---

## Manual QA to double-check post-merge (cannot click through the real admin UI from here)

1. In `/admin/gazebos/bookings` (and `/admin/ps-park/bookings`): mark a booking `NO_SHOW`, let a
   manager create a *new* overlapping booking on the freed slot via the real admin UI (not mocked
   Prisma), then attempt "Чек-ин" on the original NO_SHOW booking and visually confirm the admin
   sees the `BOOKING_CONFLICT` error surfaced in the UI (toast/inline message), not just that the
   API call fails silently.
2. Same setup, but without a competing booking — confirm the "opoздавший гость" late check-in flow
   still visually shows the booking transitioning to `CHECKED_IN` with the late-arrival indicator
   the UI already displays for `lateCheckedInAt`.
3. Concurrency smoke test in a real (non-unit-test) environment: two managers/browser tabs racing a
   NO_SHOW→CHECKED_IN reactivation against a fresh competing booking creation on the same slot at
   effectively the same moment — confirm the Postgres advisory lock actually serializes them in
   production-like conditions (unit tests mock Prisma and cannot exercise real lock contention).
4. Confirm no regression in the browser network tab: `checkin` requests for `CONFIRMED` bookings
   should complete with the same latency profile as before (no unexpected added transaction
   overhead), since code review confirms they still bypass `$transaction` entirely.

This is the standard "no live browser verification" gap already acknowledged as an agent
limitation in CLAUDE.md / the review report — not a defect found in this pass, just the residual
manual-QA surface for the repo owner.

---

## Тест-план (сводка)

### Скоуп
`checkInBooking()` в `src/modules/gazebos/service.ts` и `src/modules/ps-park/service.ts` —
переход `NO_SHOW → CHECKED_IN` (опоздавший гость) должен проверять занятость слота под advisory-
блокировкой, как и создание брони; переход `CONFIRMED → CHECKED_IN` не должен получить лишних
накладных расходов.

### Тест-кейсы (соответствуют AC 1-3 выше)

#### TC-1: NO_SHOW → CHECKED_IN на свободный слот
- **Приоритет**: Critical
- **Тип**: Functional / API (unit-level, mocked Prisma)
- **Шаги**: бронь в статусе `NO_SHOW` → `checkInBooking(id, managerId)` → слот свободен под
  блокировкой (`tx.booking.findFirst` → `null`)
- **Ожидаемый результат**: `status` меняется на `CHECKED_IN`, `lateCheckedInAt` сохраняется в
  metadata, `$transaction`/`lockSlot` вызваны
- **Статус**: Pass

#### TC-2: NO_SHOW → CHECKED_IN на занятый слот
- **Приоритет**: Critical
- **Тип**: Functional / API / Security (data integrity — double-booking prevention)
- **Шаги**: бронь в статусе `NO_SHOW` → слот уже занят другой активной бронью (`CONFIRMED`) →
  `checkInBooking(id, managerId)`
- **Ожидаемый результат**: reject с `code: "BOOKING_CONFLICT"`, `prisma.booking.update` НЕ вызван
- **Статус**: Pass

#### TC-3: CONFIRMED → CHECKED_IN без лишней блокировки
- **Приоритет**: High
- **Тип**: Functional / Regression
- **Шаги**: бронь в статусе `CONFIRMED`, `startTime` в прошлом → `checkInBooking(id, managerId)`
- **Ожидаемый результат**: `status` меняется на `CHECKED_IN`, `prisma.$transaction` НЕ вызван
- **Статус**: Pass

### Edge cases
- [x] Конкуренция (двойное бронирование) — покрыто TC-2 через advisory lock + конфликт-чек
- [ ] Пустые/невалидные данные — не применимо (нет новых пользовательских полей в этом фиксе)
- [ ] Превышение лимитов (rate limiting) — не применимо (роуты не тронуты этим диффом)
- [x] Недостаточные права (403) — RBAC не менялся, подтверждено что роуты вне диффа

### Результат
- Всего кейсов: 3 (плюс independent findings выше)
- Пройдено: 3
- Провалено: 0
- Заблокировано: 0
