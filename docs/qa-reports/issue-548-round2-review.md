# Review: Issue #548 — btree_gist EXCLUDE constraint backstop (round 2)

## Вердикт: PASS

Round 1's single blocking finding — the backstop firing would produce a silent, unlogged 500 because every calling route.ts has its own top-level `catch → apiServerError()` that never reaches `onRequestError` — is fixed correctly and completely. No new issues found.

## Coverage (point 1)

All 9 production `lockSlot(tx, ...)` call sites are wrapped with `.catch(async (err) => { if (await handleOverlapBackstop(...)) { throw <DomainError>; } throw err; })` immediately after the closing `})` of their `prisma.$transaction(...)` call:

| Site | File:Line | Wrapped |
|---|---|---|
| public create | `src/modules/gazebos/service.ts:312-363` | ✅ |
| admin create | `src/modules/gazebos/service.ts:551-610` | ✅ |
| reschedule | `src/modules/gazebos/service.ts:792-829` | ✅ |
| NO_SHOW→CHECKED_IN | `src/modules/gazebos/service.ts:1428-1461` | ✅ |
| public create | `src/modules/ps-park/service.ts:258-303` | ✅ |
| admin create | `src/modules/ps-park/service.ts:1047-1105` | ✅ |
| NO_SHOW→CHECKED_IN | `src/modules/ps-park/service.ts:1187-1220` | ✅ |
| extendBooking | `src/modules/ps-park/service.ts:1650-1679` | ✅ |
| restore | `src/modules/booking/restore.ts:95-215` | ✅ |

Cross-checked by grepping every `lockSlot(tx` occurrence in `src/` (13 total: 9 production + 3 in `slot-lock.test.ts` which correctly call the raw `lockSlot` export, not through a `.catch`-wrapped transaction, since that test exercises `lockSlot` itself, not the wrapping). No production site missed. Count matches the commit message (4 gazebos + 4 ps-park + 1 restore).

Note: `gazebos/service.ts:1414-1423` and `ps-park/service.ts:1173-1182` have an early-return direct `prisma.booking.update` (non-NO_SHOW checkInBooking path) with no `lockSlot`/transaction at all — this is pre-existing, unrelated to this diff (it's a pure status flip with no slot/overlap semantics), and out of scope for #548.

## Behavioral correctness for the normal case (point 2)

Traced concretely for `gazebos/service.ts` public `createBooking` (lines 312-363): when the in-transaction `findFirst()` conflict-check finds a race and does `throw new BookingError("BOOKING_CONFLICT", ...)` from inside the `tx` callback, `prisma.$transaction()` rejects with that exact `BookingError` instance (Prisma re-throws the callback's error, doesn't wrap it). The chained `.catch(async (err) => {...})` receives that `BookingError`. `handleOverlapBackstop` checks `err instanceof Prisma.PrismaClientUnknownRequestError` — `BookingError` is not that class, so it returns `false` without logging, and the handler does `throw err`, re-throwing the identical `BookingError` unchanged. Same pattern verified at all 8 other sites (each `.catch` re-throws the domain error type native to that module: `BookingError`/`PSBookingError`/`BookingRestoreError`). No behavior change for callers on the ordinary race path — confirmed both by code tracing and by the fact that all existing tests for these paths (gazebos/ps-park/restore `service.test.ts`/`restore.test.ts` conflict-case tests) still pass unmodified.

## Detection logic soundness (point 3)

Independently verified, not just trusted: inspected the shipped `@prisma/client@6.19.3` native query engine binary (`node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node`) via `strings`. The engine's internal `ConnectorError` kinds that map to typed `PrismaClientKnownRequestError` P-codes are an explicit enumerated set (`UniqueConstraintViolation`→P2002, `NullConstraintViolation`→P2011, `ForeignKeyConstraintViolation`→P2003, `TableDoesNotExist`, etc.) — there is no `ExclusionViolation`/`ExclusionConstraintViolation` kind in that list, despite the engine's Postgres SQLSTATE parser recognizing `23P01` (exclusion_violation) at the wire-protocol level (it's just not promoted to a typed/known Prisma error). An unmapped DB error surfaces through the Node client's generic/opaque error path, which is exactly `PrismaClientUnknownRequestError` (no `code` field — that's what distinguishes it from `PrismaClientKnownRequestError`). This confirms the code's `error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes("booking_no_overlap")` detection is correct, independent of the author's own empirical claim (which is also stated to have been separately verified against a real local Postgres 16 instance).

## Verification runs (point 4)

- `npx tsc --noEmit` — clean, no errors.
- `npx eslint` on all 6 changed files — clean, no errors/warnings.
- `npm test -- --run` (full suite) — **257 test files, 3695 tests, all passed.**
- Targeted run of `slot-lock.test.ts`, `restore.test.ts`, and the gazebos/ps-park `__tests__` dirs — all green, including the two tests that were broken pre-fix (`restore.test.ts`'s `vi.mock("../slot-lock", ...)` now correctly exports `handleOverlapBackstop: vi.fn(async () => false)`).

The previously-broken `restore.test.ts` tests were confirmed to assert what they originally intended: `"блокирует восстановление, если слот успели пересдать"` (line 140-157) mocks `tx.booking.findFirst` to return a conflicting row, which makes `restoreBooking`'s own in-transaction check throw `BookingRestoreError("SLOT_TAKEN", ...)` — the mocked `handleOverlapBackstop` returns `false`, so the `.catch` re-throws that same error unchanged, and the test correctly asserts `rejects.toMatchObject({ code: "SLOT_TAKEN" })`. This is the ordinary app-level conflict path, not the DB backstop — exactly what the test was written to check before this diff existed, now passing again with the mock updated for the new import.

## New test realism (point 5)

Checked `Prisma.PrismaClientKnownRequestError`/`Prisma.PrismaClientUnknownRequestError` constructor shapes used in `slot-lock.test.ts` against the real shipped type declarations (`node_modules/@prisma/client/runtime/library.d.ts`):
- `PrismaClientKnownRequestError(message: string, { code, clientVersion, meta, batchRequestIdx }: KnownErrorParams)` — test calls `new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6.19.3" })`. Matches (`meta`/`batchRequestIdx` optional).
- `PrismaClientUnknownRequestError(message: string, { clientVersion, batchRequestIdx }: UnknownErrorParams)` — test calls `new Prisma.PrismaClientUnknownRequestError(<message>, { clientVersion: "6.19.3" })`. Matches (`batchRequestIdx` optional).

Both classes are confirmed re-exported under the `Prisma` namespace (`node_modules/.prisma/client/index.d.ts:2153-2154`: `export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError`, same for Unknown). The test error message shape (`'Invalid \`prisma.booking.create()\` invocation:\n\nconflicting key value violates exclusion constraint "booking_no_overlap"'`) is realistic Postgres/Prisma phrasing (Postgres's actual exclusion-violation message is `conflicting key value violates exclusion constraint "..."`). Tests compile and run against the real library (confirmed via `tsc`/`vitest` runs above) — not a shape that would fail against the real package.

## Scope (point 6)

`git diff 8efd9cc2..e5042c10 --stat` — exactly the 6 described files, 146 insertions / 5 deletions, no drive-by changes. Full branch diff (`main...HEAD`, both commits) — 8 files total (adds the unchanged migration.sql + schema.prisma from round 1's 8efd9cc2), consistent with the round-1-approved migration plus this round's fix. No scope creep.

## Acceptance Criteria
| AC | Статус | Комментарий |
|----|--------|-------------|
| DB backstop constraint exists, mirrors app-level overlap semantics | PASS | Unchanged from round 1 (`booking_no_overlap`, `EXCLUDE USING gist`, additive migration) |
| Backstop firing is observable in production (round-1 blocking gap) | PASS | `handleOverlapBackstop` + `log.error("booking", ...)` wired into all 9 sites; ERROR level → Telegram admin group per CLAUDE.md monitoring table |
| Normal (non-backstop) conflict path unchanged | PASS | Traced concretely; `handleOverlapBackstop` returns `false` for domain errors, `.catch` re-throws unchanged; existing conflict tests pass unmodified |
| Tests cover detection + non-detection cases | PASS | 4 new cases in `slot-lock.test.ts`: real-shaped exclusion violation, domain `BookingError`, P2002 known error, unrelated unknown error |

## Scope Check
- Scope creep: Нет
- Лишние изменения: нет

## Качество кода
- TypeScript strict: OK (`tsc --noEmit` clean)
- Zod валидация: N/A (no new inputs/endpoints in this diff)
- API формат: N/A (no route handler changes)
- Тесты: OK (full suite green, 257 files / 3695 tests; new tests target the exact gap round 1 flagged)

## Безопасность
- RBAC: N/A — no new/changed endpoints, no auth surface touched
- Утечки данных: OK — `grep -iE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` over the full `8efd9cc2..e5042c10` diff returns nothing; logged metadata is limited to `moduleSlug`/`resourceId` (internal identifiers, not PII, consistent with existing logging patterns elsewhere in the codebase)
- Supply chain: OK — no new dependencies
- Injection: OK — detection is `error.message.includes("booking_no_overlap")`, a literal substring check on an error string never fed back into a query; no raw SQL added in this commit (migration SQL was round-1-approved, additive-only)
- Dangerous ops: OK — no destructive migrations, no `rm -rf`/force-push in scripts

## Что хорошо
- The fix precisely targets the exact gap round 1 identified — no more, no less.
- `handleOverlapBackstop`'s detection was independently re-derivable from Prisma's shipped query-engine binary (enumerated `ConnectorError` kinds have no exclusion-violation case), corroborating the author's empirical claim rather than just trusting it.
- Reusing the same domain-specific error class/code at each site (rather than inventing a generic one) keeps the API contract for callers identical to the existing race-condition path — no client-facing behavior change, only added observability.
- Good instinct logging at ERROR (not WARNING) severity, matching the "this should never happen — if it does, page someone" intent of a true backstop.
