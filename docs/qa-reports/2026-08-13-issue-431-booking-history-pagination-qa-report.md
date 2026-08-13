# QA: Issue #431 — booking-history pagination actually pages (gazebos + ps-park)

## Вердикт: PASS

Branch: `claude/issue-431-booking-history-pagination`, commit `c444816` (single commit), diff vs `main`.
Verified independently from the code-review PASS (`docs/qa-reports/2026-08-13-issue-431-booking-history-pagination-review.md`), not just re-reading it.

---

## Regression / build gates

| Check | Result |
|-------|--------|
| `npm test -- --run` | **209 test files / 3127 tests, all passing** |
| `npx tsc --noEmit` | Clean, no errors |
| `npm run lint` | 0 errors, 15 pre-existing warnings — all in unrelated files (`messenger/*`, `notifications/service.ts`, `telephony/novofon-client.ts`); none of the 8 files touched by this diff appear in the warning list |
| Targeted new tests: `src/app/api/gazebos/bookings/__tests__/route.test.ts`, `src/app/api/ps-park/bookings/__tests__/route.test.ts`, `src/modules/gazebos/__tests__/validation.test.ts`, `src/modules/ps-park/__tests__/validation.test.ts` | **4 files / 107 tests, all passing** |

---

## Acceptance criteria table

| # | AC (per issue #431's prescribed fix) | Verdict | Evidence |
|---|---|---|---|
| 1 | `page`/`perPage` added to `bookingFilterSchema` / `psBookingFilterSchema` | PASS | `src/modules/gazebos/validation.ts:45-46`, `src/modules/ps-park/validation.ts:53-54` — `z.coerce.number().int().positive().default(1)` and `...positive().max(100).default(20)`, matching the existing codebase pagination pattern (e.g. `telephony/validation.ts`). |
| 2 | Both `GET /api/{gazebos,ps-park}/bookings` routes call `listBookingsPaginated` (already existed) | PASS | Read both route files end-to-end (`src/app/api/gazebos/bookings/route.ts`, `src/app/api/ps-park/bookings/route.ts`): `listBookings` import removed, `listBookingsPaginated(parsed.data)` called, no dead branch, no fallback path that could bypass it. |
| 3 | `skip`/`take` pagination math is correct | PASS | Read `listBookingsPaginated` in both services (`gazebos/service.ts:1528-1571`, `ps-park/service.ts:1866-1909`): `page = params.page ?? 1`, `perPage = params.perPage ?? 20`, `skip = (page - 1) * perPage`, `take: perPage`. Page 1 → `skip 0`; page 2 → `skip perPage`. Correct in both modules, identical logic. |
| 4 | `total` is a real DB count on the same `where`, not derived/fixed | PASS | Same `where` object built from `params.status/resourceId/dateFrom/dateTo` is passed to both `prisma.booking.findMany` and `prisma.booking.count({ where })` in a single `Promise.all` — no divergence, no hardcoded number. |
| 5 | `status`/`resourceId`/`dateFrom`/`dateTo` still correctly threaded through (not dropped like `page`/`perPage` was) | PASS | All four params are individually checked and merged into `where` inside `listBookingsPaginated` in both modules — none silently stripped. |
| 6 | Response `meta` includes `{total, page, perPage}` | PASS | Both routes: `return apiResponse(enriched, { total, page, perPage })`. `apiResponse()` sets `body.meta = meta` verbatim (`src/lib/api-response.ts`) — no transformation, round-trips exactly. |
| 7 | UI already sends `page`/`perPage` and reads `meta.total` — no UI change needed | PASS | Confirmed by direct read of both components: `booking-history-table.tsx` and `ps-park-booking-history-table.tsx` both build `new URLSearchParams({ page: String(page), perPage: String(perPage) })` and do `setTotal(json.meta?.total ?? 0)`. Diff doesn't touch either file — genuinely a pure backend fix. |
| 8 | Tests: "validation + route happy path с meta.total" | PASS | Validation: `defaults page to 1 and perPage to 20 when absent` / `coerces page/perPage from query-string values` / `rejects perPage above the cap` / `rejects non-positive page`, ×2 modules — real `safeParse` assertions on `.data.page/.perPage`, not placeholders. Route: `happy path: routes to listBookingsPaginated and returns meta.total/page/perPage` asserts `json.meta` deep-equals `{total, page, perPage}` and the mocked service call args, ×2 modules. Confirmed by name AND by reading the assertion bodies — not just similarly-named filler tests. |

---

## Independent findings beyond re-confirming the review

- **Regression-test failure mode verified by tracing the mock, not just trusting the reviewer's claim**: since the route test mocks `@/modules/{gazebos,ps-park}/service` to export only `listBookingsPaginated`, reverting `route.ts` to import `listBookings` would resolve to `undefined` under the mock → `TypeError` inside the route's `try/catch` → 500 `apiServerError()`. Every assertion in the happy-path test (status 200, `meta.total/page/perPage`, service call args) would then fail. This is a genuine regression guard against re-introducing the bug, confirmed by reading the mock setup, not assumed.
- **Second latent bug (user/resource population)** is real and correctly fixed as an unavoidable side effect of switching to `listBookingsPaginated` (which has `include: { user: {...} }` + manual `resourceMap`), consistent with what both admin table components already read (`b.user`, `b.resource`). Not a scope violation — it's the same function swap the issue asked for.
- **`userId` filter gap**: confirmed independently — `listBookingsPaginated`'s `params` type has no `userId` field and its `where`-building code never references it, even though both filter schemas validate and pass through a `userId` field structurally. Grepped both admin table components and found neither sends `?userId=`, so this is currently unexercised/non-user-facing. Already tracked as a separate follow-up (issue #509 per task description) — correctly out of scope for this fix, does not block PASS.
- **Ordering side effect**: `listBookingsPaginated` orders `{ date: "desc" }` vs the now-dead `listBookings`'s `{ date: "asc" }`. This was pre-existing in `listBookingsPaginated` (not touched by this diff) but becomes user-visible for the first time here — admin history will show newest-first. Reasonable for a history view, not a defect, not blocking.
- **`listBookings()` left dead in place** in both `service.ts` files (only reachable from their own `__tests__/service.test.ts`) — correct scoping decision for a bug-fix PR per CLAUDE.md's "one PR = one feature" rule; a cleanup candidate for a separate PR, not this one.
- No RBAC change in this diff (routes had no `auth()`/role gate before and still don't) — pre-existing, explicitly out of scope for this fix. Flagging for visibility, not blocking, since it's unrelated to what #431 asked for and the reviewer already called it out.

---

## Security functional checks (relevant subset)

- **Input validation**: `perPage=500` → rejected with `422 VALIDATION_ERROR`, service never called (confirmed by the `"rejects perPage above the cap without calling the service"` test in both route test files). `page=0` → rejected at schema level (`.positive()`). Non-numeric `page`/`perPage` values fail `z.coerce.number()` cleanly, no crash path.
- **Data leakage**: `listBookingsPaginated` now surfaces `user.{name,phone,email}` via `include`, where `listBookings` exposed none. This is admin-scoped booking data (the same data an admin already sees per-booking elsewhere), intentional and required for the UI's `b.user` read, not a leak of secrets/credentials. `email` is fetched but not rendered by either table currently — not flagged as a defect since it's an admin-only endpoint and the data isn't secret-class.
- **Injection**: all query building goes through Prisma's typed `where` object; no raw SQL, no string interpolation of filter values.
- **RBAC**: no change (see finding above) — not a regression introduced by this PR, pre-existing gap out of scope.

No security-case FAIL found for the changes in this diff.

---

## Manual QA to double-check post-merge (I can't click through the real admin UI from here)

1. In `/admin/gazebos/bookings` and `/admin/ps-park/bookings`, click the → pagination arrow and visually confirm the row set actually changes (different booking IDs/dates), not just the same first-20 re-rendered.
2. Click all the way to the last page and confirm the ← arrow correctly disables at page 1 and → disables at the last page (`totalPages = Math.ceil(total / perPage)`).
3. Cross-check the displayed "N записей" total against `SELECT count(*) FROM "Booking" WHERE "moduleSlug" = 'gazebos' AND "deletedAt" IS NULL` (and same for `ps-park`) in the real DB, to catch any environment-specific `where`-clause drift not visible in unit tests with mocked Prisma.
4. Apply a `status` filter + `dateFrom`/`dateTo` together, then paginate — confirm the filter stays applied across page changes (not reset) and that `total`/pagination reflect the filtered count, not the unfiltered total.
5. Confirm booking rows now show the client/gazebo(or table) name correctly even when the booking's own `clientName`/`clientPhone` snapshot fields are null and it must fall back to `b.user`/`b.resource` — this is the second bug fixed by this diff and is worth an explicit manual look since unit tests mock the service layer.
6. Spot-check that admin history is now newest-first (per the `orderBy` flip called out above) and confirm this is acceptable/expected to the product owner, since it's a user-visible change not explicitly mentioned in the PR description.
7. Confirm no console/network errors on the admin bookings pages after deploy (route previously threw for `listBookings` under certain mocks; verify prod doesn't hit an unexpected 500 on first load with a fresh empty filter set).
