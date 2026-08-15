# QA Report: ps-park createAdminBooking/createBooking не проверяли minBookingHours на сервере (issue #567)

Branch `claude/issue-567-ps-park-min-booking-hours-admin`, commit `76aaed5`,
diff vs `main`: `src/modules/ps-park/service.ts` (+26) и
`src/modules/ps-park/__tests__/service.test.ts` (+29). No route.ts changes.

## Вердикт: PASS

---

## 1. Regression gates

| Check | Result |
|-------|--------|
| `npm test -- --run` | 255 files / 3628 tests passed |
| `npx tsc --noEmit` | clean, no errors |
| `npm run lint` | 0 errors, 16 pre-existing warnings, all in unrelated files (`messenger`, `notifications/service.ts`, `telephony/novofon-client.ts`) — none touched by this diff |
| Isolated `vitest run src/modules/ps-park/__tests__/service.test.ts` | 110/110 passed |

## 2. AC1 — `createAdminBooking` enforces `minBookingHours` server-side

Read `src/modules/ps-park/service.ts:971-1003`. In `createAdminBooking`, the
new check:

```ts
const minHoursAdmin = await getMinBookingHours();
const durationHoursAdmin = (end.getTime() - start.getTime()) / 3_600_000;
if (durationHoursAdmin < minHoursAdmin) {
  throw new PSBookingError("DURATION_BELOW_MIN", ...);
}
```

sits immediately after the `DATE_IN_PAST` check (line 992-994) and **before**:
- the pre-check `conflict` lookup (line 1005),
- guest user creation / `upsertClientByPhone` (line 1027-1038),
- item snapshot validation (line 1042),
- the Google Calendar call (line 1056),
- the `prisma.$transaction` block containing `tx.booking.create` (line 1068+).

No side effect (DB write, external API call, or client record creation) can
occur before this validation. `PASS`.

## 3. AC2 — guest/public path (`createBooking`) checked for the same gap, applied

Read `src/modules/ps-park/service.ts:221-253`. The identical pattern was
added to `createBooking` (public/guest booking, `POST /api/ps-park/book`)
right after its own `DATE_IN_PAST` check (line 242-244) and before item
validation, pricing, and the `prisma.$transaction`/`tx.booking.create` block
(line 275+). This matches the gazebos precedent (three call-sites) — ps-park
now has parity across its two booking entry points. `PASS`.

## 4. AC3 — regression tests exist, fail before fix / pass after

Two new tests in `src/modules/ps-park/__tests__/service.test.ts`:

- `createBooking > "throws DURATION_BELOW_MIN when booking is shorter than
  configured minBookingHours"` (line ~199) — mocks `Module.config` to
  `{ minBookingHours: 2 }`, calls `createBooking` with the 1h fixture
  (`validBookingInput`, 12:00-13:00), asserts `rejects.toMatchObject({ code:
  "DURATION_BELOW_MIN" })`.
- `createAdminBooking > "отказывает, если админ-бронь короче настроенного
  minBookingHours"` (line ~2094) — same setup for `createAdminBooking`,
  additionally asserts `expect(prisma.booking.create).not.toHaveBeenCalled()`.

**Verified these are genuine regressions, not tautological mocks**: I
temporarily swapped `src/modules/ps-park/service.ts` back to the `main`
version (validation removed) while keeping the new test file, and re-ran
just this file:

```
FAIL  createBooking > throws DURATION_BELOW_MIN when booking is shorter than configured minBookingHours
FAIL  createAdminBooking > отказывает, если админ-бронь короче настроенного minBookingHours
Test Files  1 failed (1)
Tests  2 failed | 2 passed | 106 skipped (110)
```

Both fail on `main` (with a downstream `TypeError` since no success-path
mocks were configured for these tests — the code proceeds past where the
guard should have stopped it) and both pass after restoring the fix (110/110
green again, working tree restored, no diff left behind). `PASS`.

Only the admin-booking test explicitly asserts
`prisma.booking.create.not.toHaveBeenCalled()`; the public-booking test
asserts only the error code. This satisfies the reviewer's specific ask
(admin-booking case must assert non-persistence) — both tests independently
satisfy AC3's "fails before / passes after" requirement regardless.

## 5. Default behavior not regressed (1h default)

`DEFAULT_MIN_BOOKING_HOURS = 1` (service.ts:64, unchanged). Test file's
global `beforeEach` (line 138) defaults `Module.config` to `{}` whenever a
test doesn't override it, so `getMinBookingHours()` resolves to `1` by
default. `validBookingInput`/`validAdminInput` fixtures are both 12:00-13:00
(exactly 1h). Every pre-existing happy-path test in the 110-test file (which
don't override `minBookingHours`) implicitly exercises this exact boundary
(`durationHours(1) < minHours(1)` is false, so booking proceeds) and all
still pass — confirmed by the full green run, no test needed to be adjusted
to accommodate the fix.

## 6. Route-level error surfacing — confirmed no route changes needed

Read both routes in full:

- `src/app/api/ps-park/admin-book/route.ts` — generic `catch (error) { if
  (error instanceof PSBookingError) return apiError(error.code,
  error.message); ... }`.
- `src/app/api/ps-park/book/route.ts` — identical pattern (plus a separate
  `InventoryError` branch, irrelevant here).

`apiError(code, message)` defaults `status = 400`
(`src/lib/api-response.ts:34-37`), so `DURATION_BELOW_MIN` surfaces as HTTP
400 with `{ success: false, error: { code: "DURATION_BELOW_MIN", message:
"Минимальное бронирование — N час(-а/-ов)" } }` — same shape as the other
pre-existing `PSBookingError` codes (`RESOURCE_NOT_FOUND`,
`CAPACITY_EXCEEDED`, `DATE_IN_PAST`, `BOOKING_CONFLICT`). No route.ts edits
were made or needed, matching the stated scope. `PASS`.

## 7. `pluralHours()` helper (new)

Read `src/modules/ps-park/service.ts:65-72`. Standard Russian pluralization
rule (1→час, 2-4→часа, else→часов, with the 11-14 exception handled via
`mod100`). Cosmetic (error message text only, not a security- or
logic-relevant path); not separately unit-tested but low risk given the
simple, well-known rule and that it's only used for a user-facing message
string.

---

## Security checklist (agents/qa.md §Security)

- [x] RBAC unaffected: diff touches only `service.ts`; both routes'
  pre-existing `auth()`/`hasRole(MANAGER)` gates (admin-book) and
  `auth()` gate (book) are untouched — verified by reading both routes.
- [x] No new public/anonymous surface introduced.
- [x] Input validation: `minBookingHours` value itself is admin-configured
  (`Module.config`, not user input) — no new injection surface; the
  comparison is purely numeric (`durationHours < minHours`), no unvalidated
  string ever reaches Prisma.
- [x] Data leakage: error message only echoes the configured `minHours`
  number, not any PII or internal ID.
- [x] Rate limiting: unchanged (module-level, applies before route handler
  regardless of this fix).
- [x] This closes a functional UI/API contract gap, not itself a
  privilege-escalation bug (per issue description) — still requires an
  authenticated MANAGER session with module access on `admin-book`, and an
  authenticated USER session on `book`. No security regression introduced.

No security case failed.

## Scope

Diff is exactly the two files stated in the task (`service.ts` +
`service.test.ts`). No route, validation schema, or unrelated module
touched. Matches "one PR = one feature."

## Conclusion

All 3 stated acceptance criteria verified against source, not just the
diff: server-side enforcement added and correctly ordered before any
persistence/side-effect in both `createBooking` and `createAdminBooking`
(AC1 + AC2), and the two new regression tests were confirmed to genuinely
fail on `main` and pass after the fix by temporarily reverting the service
code and re-running (AC3). Full suite (`npm test`, `tsc --noEmit`, `lint`)
is green with no regressions to the pre-existing 1h-default happy paths.

**Вердикт: PASS**
