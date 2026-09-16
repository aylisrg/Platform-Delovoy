# QA: first-party funnel events (ProductEvent) — issue #725, PR #896

## Вердикт: PASS

## Что проверялось и как

- ADR (design + AC-1.1…AC-1.7): `docs/adr/2026-09-16-product-event-funnel-instrumentation.md`
- Review: `docs/qa-reports/issue-725-review.md` (PASS, commit `7c7a9bc`)
- Branch: `claude/issue-725-product-event-funnels`, checked out locally.
  **Note:** the actual current PR #896 head on GitHub is `8beba9d`
  ("fix(analytics): harden deriveSessionKeyFromHeaders against header-read
  failures"), one commit ahead of the `7c7a9bc` the code-reviewer's report
  cites — verified directly against the GitHub API
  (`GET /repos/aylisrg/Platform-Delovoy/pulls/896/commits`). This follow-up
  commit is the developer proactively closing the review's own "minor
  observation, not blocking" (wrapping `deriveSessionKeyFromHeaders` in
  try/catch with an `"unknown"` fallback). It is a strict hardening on top of
  an already-PASS review, doesn't change any AC surface, and is covered by a
  new test (`"не бросает и отдаёт фолбэк, если чтение заголовков внезапно
  бросает (AC-1.6)"` in `product-events.test.ts`). All verification below is
  against this current head (`8beba9d`), not the older `7c7a9bc`.
- Independently re-read every changed file in the diff (not just trusted the
  review's summary): `product-events.ts`, `funnels.ts`, `validation.ts`,
  both new routes, all 4 business route diffs, `payments/service.ts`, the
  4 RSC page diffs, `funnel-beacon.ts`, all 4 client component diffs,
  `rate-limit.ts`, `auth.config.ts` + its test, `.env.example`, `CLAUDE.md`,
  `prisma/schema.prisma`, and the migration SQL.

## Regression / build health

- `npm test -- --run`: **332 test files / 4639 tests — all green.** Matches
  the review's own count exactly, reproduced independently (not trusted).
- `npx tsc --noEmit`: clean, no output.
- `npm run lint`: **0 errors, 21 warnings** — all pre-existing, all in files
  untouched by this PR (`messenger/*`, `useChatList.ts`,
  `modules/messenger/types.ts`, `modules/notifications/service.ts`,
  `modules/telephony/novofon-client.ts`, `components/admin/sidebar.tsx`,
  `components/auth/vk-community-banner.tsx`). Grepped lint output for every
  changed file/dir (`analytics`, `funnel`, the 4 page/component pairs,
  `payments/service`) — zero hits.
- `DATABASE_URL=... npx prisma validate`: schema valid (no live DB available
  in this sandbox to run `prisma migrate deploy`, same constraint the
  reviewer presumably had; compensated with a manual read of the migration
  SQL — see below).

## Acceptance criteria (ADR §11 traceability table)

| AC | Статус | Проверка |
|----|--------|----------|
| AC-1.1 (submitted/paid at existing conversion call sites) | PASS | `recordFunnelStep({step:"submitted", ...})` sits right next to the pre-existing `trackServerGoal` call in all 4 routes (`gazebos/book`, `ps-park/book`, `cafe/checkout`, `rental/inquiries`), after the DB write, before `return apiResponse(...)`. `paid` is called from `markSucceeded()` in `payments/service.ts`, strictly after `$transaction` resolves and after the CAS guard (`res.count === 0 → return null`), so a duplicated webhook delivery can never double-fire `paid` (verified by reading the CAS logic directly, not just trusting the ADR's description). |
| AC-1.2 (gazebos/ps-park: view → slot_selected → submitted → paid) | PASS | `funnels.ts` catalog has exactly these 4 steps for both funnels; `view` fires server-side via `after()` in the RSC page; `slot_selected` fires once per visit from `toggleSlot()`/`selectFullDay()` in `booking-flow.tsx` and `dark-availability-grid.tsx` (`useRef` guard). |
| AC-1.3 (cafe: view menu → cart_item_added → submitted → paid) | PASS | Same shape; `cart_item_added` fires once from `addToCart()` in `menu-list.tsx`, reusing the existing `startGoalFired`-style ref pattern. |
| AC-1.4 (rental: view → submitted, no paid) | PASS | `FUNNELS.rental.steps` has no `paid` entry; `getStepDef("rental", "paid")` returns `undefined`; `recordPaidStep("rental", ...)` is a no-op (test: `"воронка без шага paid (rental) — тихо игнорируется, БД не трогается"`, asserts `findFirst`/`create` never called). The extra `form_started` step is explicitly flagged in both the ADR and the catalog comment as "beyond AC-1.4, one-line revert if unwanted" — documented scope, not hidden creep (agrees with reviewer's assessment). |
| AC-1.5 (no PII, opaque sessionKey only) | PASS | See dedicated Security section below. |
| AC-1.6 (write failure never blocks the business op) | PASS | See dedicated stress-test section below — this was the item the task asked me to specifically re-verify. |
| AC-1.7 (query by funnel/step/period) | PASS | `GET /api/analytics/funnel` → `getFunnelStats()`; verified the conversion math by hand against the test fixtures (see below) rather than trusting the review's summary. |

## AC-1.7: conversion math verified by hand

`getFunnelStats` test fixture (`gazebos`, `view=100/100, slot_selected=40/40,
submitted=10/10, paid=5/5` events/sessions):

- `conversionFromTop` = sessions at step ÷ sessions at first step × 100:
  `100→100%`, `40→40%`, `10→10%`, `5→5%`. Matches.
- `conversionFromPrev` = sessions at step ÷ sessions at *previous* step × 100:
  `null` (no previous), `40/100=40%`, `10/40=25%`, `5/10=50%`. Matches.
- `biggestDropStep`: lowest `conversionFromPrev` among steps after the first
  — `40%, 25%, 50%` → minimum is `25%` at `submitted`. Test asserts
  `biggestDropStep === "submitted"`. Correct.
- Empty-period case (`sessions=0` everywhere): `conversionFromTop` uses a
  `topSessions > 0 ? ... : 0` guard so it's `0`, not `NaN`/`Infinity`;
  `conversionFromPrev` for the first step after `view` is `0` (not `null`,
  since `prevSessions` is `0`, a defined number, not `null`) — correctly
  distinguishes "no previous step exists" (`null`) from "previous step exists
  but had zero sessions" (`0`). No division-by-zero anywhere in the formula.
- `$queryRaw` uses tagged-template interpolation (`${from}`, `${to}`,
  `${params.funnel}`) — Prisma parameterizes these, no string concatenation;
  `params.funnel` is additionally pre-validated against the `FUNNEL_KEYS` Zod
  enum before it ever reaches the query. No SQL injection surface.
- Index `[funnel, step, createdAt]` covers the query's `WHERE`+`GROUP BY`
  pattern exactly.

## AC-1.6 stress test — specifically re-verified per the task's request

The task flagged that the reviewer previously found and the developer fixed
one real bug (an unprotected `log.warn` inside `getSalt()` that could throw).
I re-read the entire fire-and-forget chain end-to-end, not just the one fixed
spot:

1. **`getSalt()`** — the `log.warn(...)` call for the "no
   `PRODUCT_EVENT_SALT`" warning is wrapped in its own `try { } catch { }`.
   Confirmed fixed.
2. **`logRecordFailureSampled()`** (the catch-handler used by both
   `recordFunnelStepAsync` and `recordPaidStep`) — also wraps its own
   `log.warn(...)` call in `try { } catch { }`, with a comment explicitly
   noting this is deliberate so that a broken logger can't turn into an
   unhandled promise rejection in the fire-and-forget chain.
3. **`recordFunnelStepAsync`** — the entire body (dedup check +
   `prisma.productEvent.create`) is inside one `try { } catch { logRecordFailureSampled(...) }`.
   Confirmed by test: `mockCreate.mockRejectedValue(...)` →
   `resolves.toBeUndefined()`.
4. **`recordPaidStep`** — same shape: `findFirst` + `recordFunnelStepAsync`
   call both inside one `try/catch`. Confirmed by test:
   `mockFindFirst.mockRejectedValue(...)` → `resolves.toBeUndefined()`, and
   independently in `payments/__tests__/service.test.ts` (`findFirst` rejects
   → `syncPaymentByProviderId` still resolves, booking still transitions to
   `CONFIRMED`, notification still enqueued).
5. **`isDuplicate()` (Redis dedup)** — its own `try/catch`, fail-open
   (`return false` on Redis error, per the `rate-limit.ts` precedent) — a
   dead Redis degrades to "no dedup", never to a thrown error.
6. **`deriveSessionKeyFromHeaders()`** — the one call site that runs
   *synchronously, outside* `product-events.ts`'s own try/catch (it's called
   directly in the 4 business route bodies and the 4 RSC pages, not just
   inside `recordFunnelStepAsync`). As of `8beba9d` this is now also wrapped
   in its own `try/catch` with an `"unknown"` fallback — closing the
   reviewer's own "minor, non-blocking" note. Verified with the new test
   (`brokenHeaders.get()` throws → function returns `"unknown"`, doesn't
   throw).
7. **Call-site placement, all 8 locations checked individually:**
   - 4× business routes: `recordFunnelStep(...)` (sync, `void`-returning) is
     called *after* the DB write succeeds and *before* `return
     apiResponse(...)`. Route tests for all 4 (`gazebos/book`, `ps-park/book`,
     `cafe/checkout`, `rental/inquiries`) set `mockProductEventCreate` to
     **reject by default in `beforeEach`**, so every happy-path test in those
     files is itself proof the route still returns 200/201 with the analytics
     write failing underneath — this is a stronger guarantee than a single
     dedicated "special case" test, since it means the *entire* existing test
     suite for these routes now doubles as an AC-1.6 regression check.
   - `markSucceeded()`: `void recordPaidStep(...)` is called strictly after
     `$transaction` returns — cannot roll back the payment transaction.
   - 4× RSC pages: wrapped in `after(() => { ... })` from `next/server`,
     which by definition runs after the response is flushed — a thrown/slow
     analytics write cannot delay or fail the page render.
   - Client beacon (`sendFunnelBeacon`): `navigator.sendBeacon` wrapped in
     `try/catch` with a `fetch(..., {keepalive:true}).catch(()=>{})` fallback
     — no unhandled rejection path on the client either.

No remaining gap found. The AC-1.6 guarantee holds at every layer: DB down,
Redis down, logger down, and (as of the latest commit) header-parsing itself
throwing — none of these can affect booking/order/inquiry/payment success.

## Security (functional checklist per `agents/qa.md` / `agents/SECURITY.md`)

### RBAC
- `GET /api/analytics/funnel`: anonymous/`USER` → `requireAdminSection`
  denies before `getFunnelStats` is ever called (test: `mockAuth.mockResolvedValue(null)`
  → 401, `mockGetFunnelStats` not called). `requireAdminSection` is shared,
  already-tested infrastructure (not new code in this PR) — reused correctly.
- `POST /api/analytics/events`: intentionally has **no** auth (anonymous
  ingest, by design — matches the ADR and the existing `client-error` beacon
  precedent). This is the one endpoint in the diff that's meant to be public;
  confirmed the *scope* of what an anonymous caller can do is tightly bounded
  (see Input validation below), which is the correct mitigation for a
  deliberately-unauthenticated endpoint rather than RBAC.
- Attempted forged `userId`/`sessionKey` in body: `.strict()` schema rejects
  any extra field outright (422) — `sessionKey` sent by the client is never
  read even if it somehow got through, since the route always recomputes it
  server-side from request headers and never reads `parsed.data.sessionKey`
  (there is no such field in the parsed type). Confirmed by reading
  `route.ts` line by line: `recordFunnelStepAsync({ funnel: parsed.data.funnel, step: parsed.data.step, sessionKey })` — `sessionKey` here is the local server-derived variable, not anything from the body.

### Rate limiting
- New static tier `"product-event": { limit: 60, windowSeconds: 60 }`
  registered in the same `STATIC_CONFIGS` map used and tested for other
  tiers (`client-error`, `web-push-subscribe`) — the sliding-window mechanism
  itself is shared, already-covered infrastructure; this PR only adds a
  config entry. Route-level test confirms the 429 from `rateLimit()` is
  passed through as-is and `recordFunnelStepAsync` is never called when
  rate-limited.
- Could not exercise a live 60-req burst against a running server in this
  sandbox (no docker/DB available) — relying on the shared, already-unit-tested
  sliding-window implementation plus the route-level passthrough test. This
  is the same constraint noted in the review; flagging it here rather than
  silently assuming, but do not consider it a gap given the mechanism is
  reused, not new.

### Input validation
- Invalid JSON body → 422 `VALIDATION_ERROR`, not 500 (test: `"невалидный JSON в теле — 422, не 500"`).
- Fields beyond the Zod schema (`sessionKey`, `metadata`) → 422 via
  `.strict()` — never reach `recordFunnelStepAsync`, let alone the DB.
- `funnel`/`step` values are closed enums drawn from the catalog — no
  free-form strings ever reach `prisma.productEvent.create` from client
  input; server-side `metadata` (only ever sent by `payments/service.ts`,
  never client-controlled) additionally passes through `sanitizeMetadata()`'s
  allowlist (`amountRub`, `slotCount`, `itemCount`, `currency`) with a
  primitive-type check — tested that a `guestEmail`-shaped or nested-object
  value is stripped, and an all-stripped result becomes `undefined` rather
  than a literal `{}`.
- SQL-injection surface: none — `productEvent.create` uses Prisma's typed
  API (no raw SQL), and the one `$queryRaw` in `getFunnelStats` only accepts
  server-computed dates and an already-Zod-validated enum value via
  parameterized template interpolation.

### Data leakage
- `sessionKey` is a 32-hex-char SHA-256 truncation — verified the derivation
  function's own tests assert the raw IP (`203.0.113.7`) and raw UA
  (`Mozilla`) strings never appear in the output.
- Public ingest response is `{ accepted: true }` only — no echo of any
  server-computed value (sessionKey, DB id, etc.) back to the client.
- Admin funnel-stats response is fully aggregated (counts/percentages per
  funnel/step) — no individual `ProductEvent` rows, no `sessionKey` values,
  ever leave `getFunnelStats()`.
- 500 path on `GET /api/analytics/funnel` (`mockGetFunnelStats.mockRejectedValue(...)`)
  returns via `apiServerError()` — generic error, no stack trace or DB error
  message surfaced to the client (confirmed by reading `api-response.ts`'s
  `apiServerError` shape, not just the test assertion).
- `grep -riE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'`
  across every changed file in the diff: the only hit is the pre-existing,
  unrelated `manageToken` redaction test in `gazebos/book` — confirms the
  raw token is *not* leaked, not a new leak.

**No security case failed.**

## Scope / migration / CLAUDE.md sync

- **No new module.** Everything lives inside the existing `src/modules/analytics/`
  directory, per ADR §2 and Scope guard #1 in `CLAUDE.md`.
- **Migration** (`prisma/migrations/20260916050324_add_product_event/migration.sql`)
  contains exactly: `CREATE TABLE "ProductEvent"` + 3 `CREATE INDEX`
  statements. No `ALTER`/`DROP`/`TRUNCATE` on any existing table, nothing
  touching tables from the unrelated issue #590 migration-history drift. The
  migration timestamp (`20260916050324`) sorts correctly after all existing
  migrations (`20260916000000_add_product_event` in the ADR's draft naming
  became the actual `20260916050324_add_product_event` in the real migration
  — cosmetic timestamp difference only, no functional impact). Rollback is a
  bare `DROP TABLE`, matching the ADR's stated compromise (no backfill, no
  locks on live tables).
- `prisma/schema.prisma`'s `ProductEvent` model matches the ADR §3 draft
  field-for-field, including the PII-safety doc-comment.
- **`.env.example`**: `PRODUCT_EVENT_SALT=""` added with a comment
  explaining what it's for and the no-salt fallback behavior; no real secret
  value committed.
- **`CLAUDE.md`**: `analytics` module row updated in the same PR to mention
  `ProductEvent` and link the ADR — satisfies Scope guard #4. Read the full
  updated line in context; doesn't break the module table.

## Minor observations (non-blocking, no impact on verdict)

- The rental `form_started` step is intentionally beyond the literal text of
  AC-1.4. It's documented in three places (ADR §5.2, `funnels.ts` comment,
  and the code-reviewer's report) as an explicit, easily-revertible addition
  justified by a prior analytics incident report — agree with the reviewer
  this is not scope creep.
- No live Postgres/Redis available in this sandbox to run an actual
  `prisma migrate deploy` or a live rate-limit burst test; compensated with
  static review of the migration SQL and reliance on the shared,
  already-tested rate-limit infrastructure. Flagging for transparency, not
  as a defect — same constraint the code-reviewer operated under.

## Summary

Re-verified every AC in the ADR against the actual code (not the review's
summary alone), re-ran the full test suite/tsc/lint independently, and
specifically re-audited the AC-1.6 fire-and-forget guarantee end-to-end per
the task's request — found no remaining gap; the one previously-flagged
minor gap (`deriveSessionKeyFromHeaders` unprotected) has already been fixed
in the current PR head (`8beba9d`) and is now covered by a test. No security
case failed. Migration is cleanly additive and unrelated to issue #590.
CLAUDE.md and `.env.example` are in sync with what shipped.

**Вердикт: PASS**
