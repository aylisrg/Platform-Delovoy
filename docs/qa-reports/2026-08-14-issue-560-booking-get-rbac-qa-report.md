# QA Report: [P0] GET /api/{gazebos,ps-park}/bookings|timeline|active-sessions — no role check (issue #560)

Branch `claude/issue-560-booking-get-rbac`, commits `2486bd1` + `5519d47`,
diff vs `origin/main`. Reviewed after 2× code-reviewer PASS (adjacent finding
filed as #561, test-coverage gap closed in `5519d47`).

## Вердикт: PASS

---

## 1. Regression gates

| Check | Result |
|-------|--------|
| `npm test -- --run` | 251 files / 3600 tests passed |
| `npx tsc --noEmit` | clean, no errors |
| `npm run lint` | 0 errors, 16 warnings (all pre-existing, in unrelated files — messenger, telephony, vk-community-banner, sidebar; none touched by this diff) |
| Isolated run of the 7 affected route test files | 7 files / 66 tests passed |

## 2. Gate placement — read all 7 route.ts files directly

Confirmed by reading source (not just diff) that in every one of the 7 GET
handlers the sequence `auth()` → `hasRole(session.user, "MANAGER")` →
`requireAdminSection(session, "<slug>")` is the **first code inside the
`try` block**, unconditionally, before any service/DB call:

| Route | Gate before | Slug |
|---|---|---|
| `gazebos/bookings/route.ts` GET | `listBookingsPaginated` | `"gazebos"` |
| `gazebos/bookings/[id]/route.ts` GET | `getBooking(id)` | `"gazebos"` |
| `gazebos/timeline/route.ts` GET | `getTimeline` | `"gazebos"` |
| `ps-park/bookings/route.ts` GET | `listBookingsPaginated` | `"ps-park"` |
| `ps-park/bookings/[id]/route.ts` GET | `getBooking(id)` | `"ps-park"` |
| `ps-park/timeline/route.ts` GET | `getTimeline` | `"ps-park"` |
| `ps-park/active-sessions/route.ts` GET | `getActiveSessions` | `"ps-park"` |

No route parses query params, hits Zod, or calls the service/Prisma before
the gate; no branch bypasses it. Slugs match the directory 1:1 (no
cross-module mixups). PATCH/DELETE siblings in the two `[id]` files were
left untouched (out of scope, already gated pre-fix) and still work — read
in full, no accidental regressions.

## 3. Hand-traced tests (would a revert of just the auth check be caught?)

Traced 3 of the 7 test files line-by-line against the route code:

- **`gazebos/bookings/__tests__/route.test.ts`** (list route) — `"rejects an
  unauthenticated request"`, `"rejects a USER-role session"`, and
  `"respects requireAdminSection denial (MANAGER without gazebos access)"`.
  `mockListBookingsPaginated` is *not* reset in `beforeEach` (only
  `mockGetSummaries`/`mockAuth`/`mockRequireAdminSection` get defaults), so
  it silently carries over a resolved value from an earlier test in the
  file. Verified this doesn't make the denial assertions vacuous: if the
  3-line gate block were reverted, `hasRole`/`requireAdminSection` would
  never run, the handler would fall through to the (still-mocked, non-empty)
  service call, and the route would return 200 instead of 401/403 —
  `expect(res.status).toBe(401|403)` and
  `expect(mockListBookingsPaginated).not.toHaveBeenCalled()` would both fail.
  Confirmed genuine.
- **`gazebos/bookings/[id]/__tests__/route.test.ts`** (single-booking GET) —
  same three cases, asserting against `mockGetBooking` (from
  `vi.mocked(getBooking)`, imported directly, not a bespoke wrapper). Same
  reasoning applies: revert → `getBooking` gets called and 200 returned →
  assertions fail.
- **`ps-park/active-sessions/__tests__/route.test.ts`** — no route params,
  simplest case. Same three tests, `mockGetActiveSessions` reset in
  `beforeEach` via `vi.clearAllMocks()` per-test (this file doesn't rely on
  cross-test leakage at all, which is even cleaner). Confirmed a revert
  would flip the status to 200 and trip `not.toHaveBeenCalled()`.

In all three, `mockRequireAdminSection.mockResolvedValue(...)` in the
denial-case test is a one-off override (not a permanently-denying mock) —
`beforeEach` sets it to `null` (allow) by default, and each denial test
explicitly overrides it to return a 403 `Response`. This is not a "mock
always returns denied" trap: the happy-path test in the same file
(`role: "MANAGER"`, default `requireAdminSection` → `null`) does reach the
service and returns 200, proving the mock is genuinely conditional and the
route genuinely branches on its return value.

Spot-checked (not hand-traced, but grepped for the same three-case pattern):
`gazebos/timeline`, `ps-park/bookings`, `ps-park/bookings/[id]`,
`ps-park/timeline` all contain the identical `"respects requireAdminSection
denial"` case — confirms the gap the reviewer flagged after the first pass
(missing this case on the two list routes) is closed by `5519d47` across
all 7 files, not just the two originally called out.

## 4. Admin UI already gated — legitimate managers won't be broken

Read `src/lib/auth.config.ts` `authorized()` (lines 112–211): for any
`pathname.startsWith("/admin")`, an unauthenticated session is denied
outright, `USER` role is denied outright, and `MANAGER`/`ADMIN` are checked
against `auth.user.adminSections` (populated from `ModuleAssignment` via the
JWT/session callbacks) with a redirect to `/admin/forbidden` on mismatch —
i.e. the exact same `hasModuleAccess`-equivalent gate the route handlers now
also enforce, just at the page level. `SUPERADMIN` always passes.

Grepped consumers of the 7 endpoints
(`booking-history-table.tsx`, `ps-park` equivalent, `active-sessions-panel.tsx`,
`timeline-grid.tsx` ×2, `mobile-timeline.tsx` ×2) and confirmed via
`grep -rl` that they are only imported/mounted from
`src/app/admin/{gazebos,ps-park}/{page.tsx,bookings/page.tsx}` — i.e. every
render path that would call these 7 GETs is already behind the middleware
gate above. A legitimate MANAGER who reaches the admin page has already
passed `adminSections.includes(section)`, so the new route-level check is
pure defense-in-depth, not a new failure mode for real users.

Notably, the comment at `auth.config.ts:119–126` explicitly documents the
history here (issue #527 — replacing a broad `startsWith` allowlist with an
exact allowlist after a prior anonymous-GET leak on these same admin
prefixes), which is consistent with why route-level gating (this PR) is
still needed in addition to the middleware gate — middleware can be
bypassed by direct route invocation in tests/tools, defense-in-depth is
correct here, not redundant.

## 5. Issue #561 — correctly filed, correctly excluded from this PR

Fetched via GitHub API: issue #561, "GET
/api/ps-park/bookings/[id]/bill не проверяет requireAdminSection
(модульный скоуп)", state `open`, labels `prio:P2` + `auto:ready`. Body
explicitly states it was found during #560's review, describes the same bug
class in the *bill* subroute (not touched by this diff — confirmed absent
from `git diff origin/main...HEAD --stat`), and explicitly says: "Не
включено в тот PR — по правилу «один PR — одна фича»." No ambiguity: #561
is a separate, correctly-scoped follow-up and is not silently expected to
land in this PR.

---

## Security checklist (agents/qa.md §Security)

- [x] RBAC: anonymous → 401 on all 7 routes (verified in test traces + code read)
- [x] RBAC: USER role → 403 on all 7 routes
- [x] RBAC: MANAGER of a different module → 403 via `requireAdminSection` (verified in code + tests, all 7)
- [x] RBAC: SUPERADMIN bypass is intentional (`requireAdminSection` design, not a gap) and doesn't affect the fix
- [x] Data leakage: PII (client name/phone) no longer reachable by plain USER sessions — this was the entire point of #560, closed
- [x] No new public/anonymous surface introduced; no changes to rate limiting or Zod schemas (out of scope, correctly unmodified)

No security case failed.

## Scope

Diff is exactly 7 route.ts files + their test files, matching the stated
issue scope. No unrelated modules touched. No scope creep.

## Conclusion

All 5 requested verification points confirmed independently (code read, not
re-review of reviewer's conclusions): gate placement is genuinely
pre-fetch on all 7 routes, hand-traced tests would genuinely catch a revert
of the auth check, admin UI consumers are already behind middleware RBAC so
no regression for legitimate managers/superadmins, and issue #561 is
correctly filed as an excluded follow-up. `npm test`, `tsc --noEmit`, and
`lint` are all green.

**Вердикт: PASS**
