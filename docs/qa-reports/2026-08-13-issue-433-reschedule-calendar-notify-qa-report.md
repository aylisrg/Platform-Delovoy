# QA: Issue #433 — rescheduleBooking синхронизирует Google Calendar и уведомляет (gazebos)

## Вердикт: PASS

Branch: `claude/issue-433-reschedule-calendar-notify`, HEAD `d00f687` (`fix(gazebos): не трогать Google Calendar до конфликт-чека при переносе`) on top of `0231dd1` (`fix(gazebos): rescheduleBooking синхронизирует Google Calendar и уведомляет`).
Verified independently from both review rounds in `docs/qa-reports/2026-08-13-issue-433-reschedule-calendar-notify-review.md` — read the full diff/files myself, manually traced control flow (not just re-ran tests / trusted the reviewer's narrative), and cross-checked claims against `git show`, the schema, and the actual event-routing/template registries.

---

## Regression / build gates

| Check | Result |
|-------|--------|
| `npm test -- --run` | **209 test files / 3147 tests, all passing** — matches both review rounds' numbers exactly |
| `npx tsc --noEmit` | Clean, no output/errors |
| `npm run lint` | 0 errors, 15 pre-existing warnings, none in any of the 6 files touched by this diff (`gazebos/service.ts`, `gazebos/__tests__/service.test.ts`, `notifications/events.ts`, `notifications/templates.ts`, `notifications/module-channel.ts`, `docs/runbooks/booking-operator-guide.md`) — warnings are all in `messenger/*`, `notifications/service.ts` (unused `getRecipientUserIds`), `telephony/novofon-client.ts` |
| `git diff main...HEAD --stat` | 6 files, 362 insertions / 3 deletions — matches the review's scope claim, no scope creep |

Note on the describe block cited in the task brief (`"перенос синхронизирует Google Calendar и уведомляет (#433)"`): it contains **6** `it(...)` cases, not 7 — counted directly from the diff (`git diff main...HEAD -- src/modules/gazebos/__tests__/service.test.ts`). Not a defect, just a correction for the record: patch-in-place, cross-resource move, no-`googleEventId` no-op, `BOOKING_CONFLICT` regression, notify-sent, and no-op-on-no-change.

---

## Acceptance criteria (per issue #433's prescribed fix)

| # | AC | Verdict | Evidence |
|---|----|---------|----------|
| 1 | `updateCalendarEvent` called when time/date changes on the same resource | PASS | `src/modules/gazebos/service.ts:746-753`. Test `"патчит то же событие в календаре при переносе времени на том же ресурсе"` (`service.test.ts:1249`) asserts the exact `(calendarId, googleEventId, {startTime, endTime})` call args. |
| 2 | Resource change → event migrates between calendars (per-`Resource.googleCalendarId`, delete+create) | PASS | `src/modules/gazebos/service.ts:754-778`. Confirmed in schema (`prisma/schema.prisma:298`) that `googleCalendarId` is a per-`Resource` field, so cross-gazebo reschedule genuinely needs delete-in-old + create-in-new, not a patch. Test `"переносит событие между календарями при смене беседки"` (`service.test.ts:1280`) mocks two distinct resources with distinct `googleCalendarId`s and asserts `deleteCalendarEvent("cal-1", "gcal-1")` + `createCalendarEvent("cal-2", ...)` + the follow-up `prisma.booking.update` persisting `googleEventId: "gcal-2"`. |
| 3 | Client + dedicated Telegram channel notified on reschedule (`booking.rescheduled`) | PASS | `EVENT_ROUTING["booking.rescheduled"] = { client: true, admin: false }` (`notifications/events.ts:18-20`), consumed by both `notifications/service.ts` and `notifications/queue.ts` (verified by direct grep — not a dead registry entry). Client template in `clientTemplates.gazebos["booking.rescheduled"]` (`templates.ts:34-35`) and channel template in `channelTemplates.gazebos["booking.rescheduled"]` (`module-channel.ts:82-83`), both correctly keyed under `gazebos`. Test `"шлёт booking.rescheduled клиенту при переносе времени/ресурса"` (`service.test.ts:1364`) asserts full payload shape including `oldStartTime`/`oldEndTime` for the "было/стало" template. |
| 4 | No notification / no calendar mutation when nothing meaningfully changed (e.g. clientName-only edit) | PASS, with one minor test-coverage gap noted below | Single shared guard `if (timeOrResourceChanged && ...)` gates both the calendar-sync block (746) and the notification block (783) — code-level guarantee that a no-op edit touches neither. Test `"не шлёт booking.rescheduled, если время и ресурс не менялись"` (`service.test.ts:1398`) asserts `enqueueNotification` not called, but does **not** additionally assert `updateCalendarEvent`/`createCalendarEvent`/`deleteCalendarEvent` not called in that same scenario — a minor gap, not a functional bug (the code path is unambiguous: both blocks share the exact same `timeOrResourceChanged` condition), see "Что можно улучшить" below. |
| 5 (issue's own note) | ps-park is explicitly out of scope (has no reschedule function, only `extendBooking`) | PASS | `git diff main...HEAD -- src/modules/ps-park/` is empty — confirmed no scope creep. |

---

## Blocking finding from round 1 (calendar-mutations-before-conflict-check) — verified fixed

Manually traced `rescheduleBooking()` end-to-end (`src/modules/gazebos/service.ts:564-806`), not just re-reading the review's narrative:

- `prisma.$transaction(...)` (694-726) now contains **only** `lockSlot` + the authoritative conflict check (`tx.booking.findFirst`, `throw new BookingError("BOOKING_CONFLICT", ...)` at 710) + `tx.booking.update` writing the new `resourceId/date/startTime/endTime/clientName/clientPhone/metadata`. No `googleEventId` write inside this transaction.
- The entire calendar-sync block (`updateCalendarEvent`/`deleteCalendarEvent`/`createCalendarEvent`, 746-778) sits strictly **after** `await prisma.$transaction(...)` returns successfully — a rejected transaction (thrown `BookingError`) propagates out of the `await` and the function exits before line 746 is ever reached. This is a hard, structural guarantee (JS/TS `await` semantics), not a "usually works" ordering — confirmed by direct reading, not inference from test pass/fail alone.
- Diffed `0231dd1` (`git show 0231dd1 -- src/modules/gazebos/service.ts`) against the current state to confirm the actual defect that was fixed: in `0231dd1`, the calendar-sync block was unconditionally placed **before** `prisma.$transaction`, gated only by `timeOrResourceChanged && booking.googleEventId` — meaning a `BOOKING_CONFLICT` throw inside the transaction would happen **after** the calendar had already been mutated (patched to a rejected time, or the old event deleted with no compensating write since the transaction never committed the new `googleEventId`). This reproduces the original bug's symptom (calendar ≠ real slot) on the conflict path instead of the happy path.

### Regression test manually traced against the pre-fix commit

`"не трогает календарь при BOOKING_CONFLICT — конфликт-чек идёт раньше синка"` (`service.test.ts:1337-1362`):

- Uses a booking **with** `googleEventId: "gcal-1"` (unlike the pre-existing conflict test `"rejects a reschedule that conflicts with another booking"` at line 1219, which uses a booking with no `googleEventId` and therefore never enters the calendar-sync branch at all — that gap is exactly what round 1 flagged as untested).
- Mock sequencing verified against actual call order: `prisma.booking.findFirst` is called twice in the real code path — once to load the booking (line 569), once inside the `$transaction` callback as `tx.booking.findFirst` (line 698). The test's `$transaction` mock (top of file, lines 68-83) delegates `tx.booking` to the exact same `prisma.booking` mock object, so `.mockResolvedValueOnce(booking).mockResolvedValueOnce(mockBooking({id:"other"}))` deterministically maps load→booking, conflict-check→a colliding booking. This is not a coincidental pass; the ordering was checked against the source, not assumed from the mock's shape.
- Verified by construction that this test would **fail against `0231dd1`**: in that commit the calendar-sync block runs unconditionally before the transaction whenever `timeOrResourceChanged && booking.googleEventId` (both true here), so `updateCalendarEvent` would have been called before the transaction ever threw `BOOKING_CONFLICT` — `expect(updateCalendarEvent).not.toHaveBeenCalled()` would fail. Confirms this is a genuine regression guard, not a tautological/vacuous test.
- Also asserts `enqueueNotification` not called on the conflict path — correct, since the throw happens before the function reaches line 783.

**Conclusion: the blocking finding is fully and correctly fixed, and the fix is covered by a test that would have caught the original defect.**

---

## Round-2 trade-off (non-atomic double-update on resource change) — independently confirmed acceptable

On resource change, the main `tx.booking.update` (714-725, inside the transaction) no longer writes `googleEventId` at all — confirmed by reading the `data` object at that call site (only `resourceId/date/startTime/endTime/clientName/clientPhone/metadata`). The new `googleEventId` is written by a **second**, non-transactional `prisma.booking.update({ where: { id: bookingId }, data: { googleEventId } })` (line 777), issued only after `deleteCalendarEvent`/`createCalendarEvent` have already run. A process crash between the transaction commit and this second update would leave a booking with correct new `resourceId/date/time` but a stale/dead `googleEventId` pointing at an already-deleted GCal event.

Independently confirmed this is an acceptable, pre-existing architectural pattern rather than a new regression:
- `src/lib/google-calendar.ts:1-7` explicitly documents: "DB is source of truth, Google Calendar is a sync target… Errors are logged but never block the booking flow." No calendar API call anywhere in `gazebos/service.ts` is wrapped in the same Prisma transaction as its corresponding DB write — this is structurally required, since holding a DB transaction open across a network round-trip to Google would be its own (worse) footgun.
- `updateBookingStatus` (`service.ts:808-925`, read in full) uses **exactly** this same shape: calendar API calls (844-869) happen entirely before the `prisma.$transaction`/`prisma.booking.update` that persists the resulting `googleEventId` (884+), and by that point all rejecting validation (`assertValidTransition`, 826-838) has already run — i.e. the calendar call only happens once the operation is known to be going ahead, same invariant as the fixed `rescheduleBooking`.
- Failure mode is bounded and self-healing: DB stays consistent for the booking's actual time/resource (never corrupted), and the next `rescheduleBooking` call for that same booking will either overwrite the stale `googleEventId` (if resource/time changes again) or simply leave the calendar untouched (if it doesn't) — a visible-but-recoverable admin nuisance, not data loss, and on a strictly narrower trigger (mid-request process crash) than the round-1 defect (any routine `BOOKING_CONFLICT`).

Agree with the round-2 review: not a blocker. This is the documented "best-effort sync target" pattern already used elsewhere in this file, not a new class of risk introduced by this PR.

---

## Security

### RBAC
- `PATCH /api/gazebos/bookings/[id]` (no-`status`-in-body branch → `rescheduleBooking`) untouched by this diff — read the route directly (`src/app/api/gazebos/bookings/[id]/route.ts`): `hasRole(session.user, "MANAGER")` → 403 → `requireAdminSection(session, "gazebos")` → 403 → only then `rescheduleBooking(id, parsed.data, session.user.id)`. `managerId` comes from `session.user.id`, never from the request body. No new call path into `rescheduleBooking` was added by this diff.

### Data leakage
- `git diff main...HEAD -- src/modules/gazebos/service.ts src/modules/gazebos/__tests__/service.test.ts src/modules/notifications/events.ts src/modules/notifications/templates.ts src/modules/notifications/module-channel.ts | grep -niE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` — no matches in actual code (the only earlier hits, when grepping the full branch diff including the uncommitted review-report addendum, were inside the review's own markdown prose describing the security checklist — not real secrets/code).
- `googleEventId` is a public GCal event identifier already persisted pre-fix; not sensitive.
- Telegram channel template (`module-channel.ts:83`, HTML `parse_mode`) correctly escapes `d.resourceName` and `d.clientName` via `escapeHtml()`, consistent with every other template in that file. `d.oldDate/oldStartTime/oldEndTime/date/startTime/endTime` are server-formatted date/time strings, not raw user input — same (pre-existing, not newly introduced) pattern as the rest of the file.

### Injection
- Only Prisma calls (`findFirst`/`findUnique`/`update`), fully parameterized; no raw SQL added.

### Supply chain / dangerous ops
- No new dependencies, no destructive migrations, no `package.json` changes.

**No security-case FAIL.** The round-1 data-integrity bug (calendar mutated before authoritative conflict check) was serious but is not classified as a security incident under `SECURITY.md`'s checklist (no RBAC bypass, no secrets leak, no injection) — and it is now fixed and regression-tested, so it does not affect this verdict either way.

---

## What's out of scope for automated verification (owner should spot-check manually)

1. **Actual visual state of the GCal event after a reschedule** — this run only verifies the correct `updateCalendarEvent`/`deleteCalendarEvent`/`createCalendarEvent` calls happen with the right arguments against a mocked `@/lib/google-calendar`; it does not (and cannot, from this environment) confirm the real Google Calendar UI reflects the new time/calendar correctly, including timezone rendering as seen by a human in the Google Calendar app.
2. **Real Telegram delivery** — the dedicated gazebos channel template renders correctly in unit tests (string assertion), but actual delivery via the bot/dispatcher to a live Telegram chat, HTML rendering (`parse_mode=HTML`), and the `adminLink("gazebos", d)` deep-link's real behavior in the Telegram client were not exercised end-to-end.
3. **Client-facing in-app/notification UI** — whether the `booking.rescheduled` client template actually surfaces in the way a real user expects (push/SSE/in-app inbox, per `messenger`/`notifications` dispatch) wasn't clicked through; only that `enqueueNotification` is called with a well-formed event.
4. **Manual reschedule via the real admin UI** end-to-end (pick a booking, change gazebo + time in the same request, confirm both the DB, GCal, and notification all reflect a single coherent "было/стало") — this run only exercises the service function directly with mocked Prisma/Calendar/queue.

---

## Что можно улучшить (non-blocking)

1. `service.test.ts:1398` ("не шлёт booking.rescheduled, если время и ресурс не менялись") could additionally assert `updateCalendarEvent`/`createCalendarEvent`/`deleteCalendarEvent` are not called in the same no-op-edit scenario — currently only `enqueueNotification` is asserted. The code guarantee is solid (single shared `timeOrResourceChanged` condition gates both blocks), so this is a test-coverage nicety, not a functional gap.
2. (Carried over from round 1, still valid, still non-blocking) `enqueueNotification`'s `data.clientName` (`service.ts:800`) reads `booking.clientName` — the value *before* this request's update — so a request that changes both time and client name in one call will notify with the stale name. Cosmetic for the admin channel only.

---

## Summary

All acceptance criteria from issue #433 are met and independently verified by direct code reading (not just re-running the existing test suite): `updateCalendarEvent` patches in-place time/date changes, resource changes correctly migrate the event between per-resource Google Calendars, `booking.rescheduled` reaches both the client and the dedicated Telegram channel with a correct "было/стало" payload, and no-op edits (e.g. clientName-only) touch neither the calendar nor the notification queue. The blocking round-1 finding (calendar mutated before the authoritative in-transaction conflict check, risking orphaned/incorrect GCal events on a routine `BOOKING_CONFLICT`) is fully fixed in `d00f687` and is covered by a regression test that was manually confirmed to fail against the pre-fix commit. The remaining non-atomicity between the resource-change path's two sequential `update` calls is a narrow, self-healing, architecturally-consistent trade-off, not a new defect class. `npm test`, `npx tsc --noEmit`, and `npm run lint` are all clean, scope is unchanged (6 files, `gazebos` + shared `notifications` registries only, `ps-park` untouched), and no security-case fails.

**Вердикт: PASS.**
