# Review: Issue #431 — booking-history pagination actually pages (gazebos + ps-park)

## Вердикт: PASS

Branch: `claude/issue-431-booking-history-pagination` (single commit `c444816`), diff vs `main`.

---

## Acceptance Criteria (per issue #431's prescribed fix)

| AC | Статус | Комментарий |
|----|--------|-------------|
| `page`/`perPage` добавлены в `bookingFilterSchema`/`psBookingFilterSchema` | PASS | `src/modules/gazebos/validation.ts:45-46`, `src/modules/ps-park/validation.ts:53-54` — `z.coerce.number().int().positive().default(1)` / `...positive().max(100).default(20)`, byte-for-byte the same shape as `src/modules/telephony/validation.ts:31-32` and `src/modules/feedback/validation.ts:30` (see Fidelity section). |
| GET-маршруты роутятся на `listBookingsPaginated` | PASS | `src/app/api/gazebos/bookings/route.ts:20`, `src/app/api/ps-park/bookings/route.ts:20` — `listBookings` import removed, `listBookingsPaginated` called with `parsed.data`, `meta` now includes `{ total, page, perPage }` (matches `ApiSuccessResponse["meta"]` in `src/lib/api-response.ts:6-12`, which already declared these fields). |
| UI reads `meta.total` (no UI change needed) | PASS | Confirmed neither `booking-history-table.tsx` (gazebos) nor `ps-park-booking-history-table.tsx` were touched — both already sent `page`/`perPage` and read `json.meta?.total`, so the bug really was 100% backend. |
| Тесты: validation + route happy path с `meta.total` | PASS | 4 new validation cases per module (defaults, coercion, cap rejection, non-positive rejection) + 5 new route-test cases per module (happy path w/ meta, defaults, page-change regression, cap-422, payment enrichment). All 18 are meaningful (see Test quality). |

### Pagination genuinely works — traced end to end
Read `listBookingsPaginated` in both `src/modules/gazebos/service.ts:1528-1571` and `src/modules/ps-park/service.ts:1866-1909`: `skip = (page - 1) * perPage`, `take: perPage`, both passed into `prisma.booking.findMany`. This function itself was **not modified** by this diff (it pre-existed, per the issue's own note that it was "called only from tests"). What changed is that the route now actually reaches it with real `page`/`perPage` values instead of them being silently stripped by Zod and instead of `listBookings()`'s hardcoded `take: 100`/no-`skip`. Requesting page 2 now produces a genuinely different DB slice.

### Second latent bug confirmed (not just an assumption)
Read both `listBookings()` (line 127 gazebos / 109 ps-park — no `include`, raw `prisma.booking.findMany`) vs `listBookingsPaginated()` (`include: { user: { select: { name, phone, email } } }` plus a manual `resourceMap` merge for `resource`). Then read the UI: `booking-history-table.tsx:95-97` does `b.clientName ?? (b.user as ...)?.name`, `(b.resource as ...)?.name`; `ps-park-booking-history-table.tsx:82-84` does the same. Before this fix, `b.user`/`b.resource` were always `undefined` on every row served by `listBookings()`, so any guest-vs-registered-user fallback and the table/gazebo name column were silently broken whenever `clientName`/`clientPhone` on the booking row itself were null. This diff fixes that too, as a direct consequence of switching functions — genuinely a second bug, not an assumption.

---

## Scope Check
- Scope creep: **Нет**.
- Files touched: exactly 8, all within gazebos + ps-park bookings validation/route/tests — matches the diffstat requested for review 1:1.
- No dependency changes (`package.json`/`package-lock.json` untouched).
- 2 modules touched, well under the 5+ module scope-creep threshold in CLAUDE.md rule #5.
- UI components (`booking-history-table.tsx`, `ps-park-booking-history-table.tsx`) genuinely untouched — confirmed by reading both; they already sent `page`/`perPage` and read `meta.total`, so no UI change was needed.
- `listBookings()` left in place, now dead in production (only reachable from `src/modules/gazebos/__tests__/service.test.ts:1363` and `src/modules/ps-park/__tests__/service.test.ts:1097` — confirmed via grep across `src/`). **Judgment: correct call for a scoped bug-fix PR.** CLAUDE.md's scope guard rule #3 ("One PR = one feature. Fix PRs close exactly one bug with one test") argues against bundling an unrelated dead-code removal into this fix — deleting `listBookings()` + its service tests would be a second, unrelated diff. Worth a follow-up cleanup issue, but not a blocker here.

---

## Качество кода
- TypeScript strict: OK — `npx tsc --noEmit` clean, no `any` introduced (grepped the diff).
- Zod валидация: OK — see Fidelity below.
- API формат: OK — `apiResponse(enriched, { total, page, perPage })`, matches `ApiSuccessResponse["meta"]`.
- Тесты: OK — `npm test -- --run` → **209 test files / 3127 tests, all passing** (includes the 18 new cases in this diff).
- ESLint: clean on all 8 changed files.

### Fidelity to the established page/perPage Zod pattern
No meaningful deviation. `z.coerce.number().int().positive().default(1)` / `z.coerce.number().int().positive().max(100).default(20)` is character-for-character identical to `src/modules/telephony/validation.ts:31-32`. `src/modules/feedback/validation.ts:30` matches for `page`. `src/modules/inventory/validation.ts` uses `.min(1)` instead of `.positive()` and caps `perPage` at 50 instead of 100 — functionally equivalent, just a different numeric cap (not a deviation in shape). No issue.

### One behavioral side-effect worth flagging (not a defect, but undocumented)
`listBookingsPaginated` orders `{ date: "desc" }` while the now-unused `listBookings` ordered `{ date: "asc" }`. This ordering flip is pre-existing in `listBookingsPaginated` (not touched by this diff) but becomes user-visible for the first time now that the route reaches it — admin history tables will show newest-first instead of oldest-first on page 1. Reasonable for a "history" view, arguably an improvement, but it's a side-effect of the function swap that wasn't called out in the PR description. Not blocking.

### Minor latent gap surfaced by this diff (flagging, not blocking)
`listBookingsPaginated`'s `params` type (`src/modules/gazebos/service.ts:1528-1535`, `src/modules/ps-park/service.ts:1866-1873`) does **not** declare/filter on `userId`, even though `bookingFilterSchema`/`psBookingFilterSchema` validate and pass through a `userId` field (`parsed.data` includes it structurally, TS doesn't excess-property-check non-literal assignments so this compiles silently). The old `listBookings()` did apply `filter?.userId` to its `where` clause. Net effect: if any caller ever sends `?userId=...` to `GET /api/{gazebos,ps-park}/bookings`, it will now be silently ignored instead of filtering — the same class of "validated-but-silently-dropped" bug this PR was fixing for `page`/`perPage`. Currently **not exploitable/user-facing**: grepped all callers of both GET routes in `src/` and confirmed neither `booking-history-table.tsx` nor `ps-park-booking-history-table.tsx` (nor any other component) ever sends `userId`. Recommend a follow-up issue to either add `userId` to `listBookingsPaginated`'s `where` or drop it from the filter schemas for consistency — not a blocker for this fix since it doesn't regress any exercised behavior and is out of the issue's stated scope.

---

## Безопасность
- RBAC: OK / no change. Neither `GET /api/gazebos/bookings` nor `GET /api/ps-park/bookings` had an explicit `auth()`/role check before this diff, and this diff adds none and removes none — the auth posture is byte-identical, confirmed via diff (no lines touching auth). This is a pre-existing gap unrelated to this PR's scope (out of scope per the review brief) and should not block this fix.
- Field exposure: `listBookingsPaginated` newly surfaces `user.{name,phone,email}` and the full `resource` object in the API response (via `include`/`resourceMap`), where `listBookings` exposed neither. This is intentional and required for the UI's `b.user`/`b.resource` reads (the second bug fixed by this PR) and is standard admin-booking-history data — not a leak of secrets/credentials. `email` is fetched but not currently rendered by either UI table; not a concern for an admin-scoped endpoint.
- Утечки данных: OK — no passwords/tokens/secrets in the diff (`grep -iE 'password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key'` on the diff returns nothing).
- Injection: OK — all Prisma, parameterized; no raw SQL.
- Supply chain: OK — no new dependencies.
- Dangerous ops: none in the diff.

**No security incident found.**

---

## Test quality
18 new/extended test cases, all meaningful:
- **Validation** (4 × 2 modules): defaults, string-coercion, cap rejection, non-positive rejection — directly exercise the exact bug (Zod silently stripping unknown fields) by asserting the fields now parse and default correctly.
- **Route** (5 × 2 modules): happy path w/ `meta.total/page/perPage`, defaults-when-absent, the **regression test** (two different `page` query values → two different `page` values in the `listBookingsPaginated` call args), `perPage` cap → 422 without calling the service, payment-status enrichment preserved.
- **Would the regression test have failed pre-fix?** Yes, traced through: the test mocks `@/modules/gazebos/service` (and `ps-park/service`) to export only `listBookingsPaginated`. The pre-fix `route.ts` imported `listBookings` (not `listBookingsPaginated`) from that same module path — under the mock, `listBookings` would resolve to `undefined`, and `listBookings(parsed.data)` would throw a `TypeError`, caught by the route's `try/catch` → `apiServerError()` (500). Every assertion in the test (status 200, `meta.total`, `meta.page`, service call args) would fail. So yes, this test is a genuine regression guard against reverting the route back to `listBookings`, even though the failure mode pre-fix is "500 because the wrong function is imported" rather than literally "same slice returned twice" — the latter is exercised at the service level by the pre-existing `listBookingsPaginated` service tests (`skip`/`take` math), not duplicated here, which is appropriate layering (route tests verify routing/plumbing, service tests verify DB-query construction).
- Mocking is correct: DB/Redis never touched, `@/modules/{gazebos,ps-park}/service` and `@/modules/payments/service` are mocked at the module boundary per CLAUDE.md convention.

`npm test -- --run`: **3127/3127 passing**, 209 test files.

---

## Что хорошо
- Precise, minimal diff — exactly the files needed, no drive-by refactors.
- Correctly identified and fixed a second latent bug (`user`/`resource` never populated) as a natural consequence of routing to the already-correct `listBookingsPaginated`, and called this out explicitly in the commit message rather than silently piggybacking it.
- Test additions mirror the exact bug mechanics (Zod silent-strip, hardcoded slice) with regression-shaped assertions, not just generic happy-path filler.
- Left `listBookings()` in place rather than scope-creeping into a cleanup — right call per CLAUDE.md's "one PR = one feature" rule, though a follow-up cleanup issue would be reasonable.

## Что можно улучшить (non-blocking, follow-up)
1. `listBookingsPaginated`'s `userId` filter gap (see above) — recommend a follow-up issue rather than blocking this fix.
2. Dead `listBookings()` in both `gazebos/service.ts` and `ps-park/service.ts` — candidate for a small cleanup PR once confirmed no other planned caller needs it.
