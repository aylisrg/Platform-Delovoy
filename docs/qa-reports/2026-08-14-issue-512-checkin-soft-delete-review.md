# Review: #512 — ps-park `checkInBooking` missing `deletedAt: null` filter

## Вердикт: PASS

Branch `claude/issue-512-checkin-soft-delete` vs `origin/main`. Commit `5e9cce2`.

## Acceptance Criteria
Issue #512: `checkInBooking()` in `src/modules/ps-park/service.ts` must filter
soft-deleted bookings (`deletedAt: null`), matching the gazebos counterpart and
every other ps-park read function already covered by the #423 soft-delete suite.

| AC | Статус | Комментарий |
|----|--------|-------------|
| `checkInBooking` lookup includes `deletedAt: null` | PASS | `src/modules/ps-park/service.ts:1121` — `where: { id: bookingId, moduleSlug: MODULE_SLUG, deletedAt: null }`. |
| Fix matches gazebos pattern | PASS | Diffed `src/modules/ps-park/service.ts:1119-1193` against `src/modules/gazebos/service.ts:1369-1442` (normalizing `PSBookingError`→`BookingError`): identical line-for-line except one pre-existing comment in ps-park unrelated to this change. |
| Regression test added | PASS | New test in `src/modules/ps-park/__tests__/service.test.ts` inside the existing `describe("soft-delete filter (deletedAt: null) in read functions", ...)` block, mirrors the adjacent `getBooking` test shape. |
| Test actually catches the bug | PASS (verified manually) | Temporarily reverted the `where` clause to `{id, moduleSlug}` (no `deletedAt`) and reran just this test — it fails as expected (`AssertionError: expected "vi.fn()" to be called with... deletedAt: null`). Restored the fix, reran the full suite — green. |

## Answers to the specific questions

1. **Only one lookup in `checkInBooking`?** Yes. Read the full function body (`service.ts:1119-1193`). There is exactly one `prisma.booking.findFirst` for the booking itself (line 1120-1122, now fixed). The only other DB read inside the function is the conflict check inside the `NO_SHOW → CHECKED_IN` transaction branch (`tx.booking.findFirst` at line 1167-1178) — that query already had `deletedAt: null` before this PR (it's the slot-conflict check from #424/#429/#478, unrelated to this bug). No second unfiltered lookup was missed.

2. **Matches gazebos exactly, and is the narrow scope still the right call?**
   - Matches exactly — confirmed via structural diff, no other functional divergence between the two `checkInBooking` implementations.
   - Scope: correct to stay narrow, but worth flagging for a **follow-up issue** (not a blocker for this PR): the same "no `deletedAt: null`" pattern still exists on the *mutation* lookups of several other ps-park functions, e.g. `markNoShow` (`service.ts:1202-1203`), `addItemsToBooking` (`service.ts:1241-1242`), and the lookups at `service.ts:1593-1594`, `1648-1649`, `2064-2065`. These are pre-existing, out of scope for #512 as written (issue text explicitly limits it to `checkInBooking`, and the existing #423 suite's `describe` block title is "read functions" — these are mutation entry points, a different category), and none of them are touched or made worse by this diff. Recommend filing that as a separate issue rather than folding into this PR — the developer was right not to touch them here (one-PR-one-feature).

3. **Test quality — is the assertion meaningful?** Yes. Verified experimentally (see AC table) that the test fails against the pre-fix `where` clause and passes against the fix, so it is not a tautology or accidentally-green test. It follows the same `expect.objectContaining` idiom as its sibling tests in the same `describe` block (`listBookings`, `getBooking`, `getTimeline`), so it's consistent with existing conventions rather than a novel/weaker pattern. Minor nit (non-blocking): the test lives under a `describe` labeled "read functions," but `checkInBooking` is a mutation — cosmetic mislabeling only, doesn't affect correctness.

4. **One PR = one feature, scope tight?** Yes. Diff touches exactly 2 files (`service.ts` +1/-1 line, test file +15 lines), one commit, no unrelated refactoring, no new dependencies, no schema changes.

5. **Red flags?** None found. `npm test -- --run` → 3606/3606 passed across 252 files. `tsc --noEmit` clean. `git status` clean, no stray files.

## Scope Check
- Scope creep: Нет
- Лишние изменения: нет — diff limited to the single `where` clause and one matching test.

## Качество кода
- TypeScript strict: OK (`tsc --noEmit` clean)
- Zod валидация: N/A (no new input surface)
- API формат: N/A (no route handler changed — internal service function)
- Тесты: OK — new test verified to fail pre-fix / pass post-fix; full suite green (3606/3606)

## Безопасность
- RBAC: N/A — no endpoint/permission logic changed, only a data-filtering predicate in an already-RBAC-gated service function.
- Утечки данных: OK — this fix *closes* a data-exposure edge case (soft-deleted booking reachable via check-in), doesn't introduce one.

## Security
- Secrets leakage: `grep -iE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` over the diff — no matches.
- RBAC: unchanged surface, no new endpoint; check-in RBAC gating happens upstream of `checkInBooking()` (not part of this diff) and was not touched.
- Injection: no raw SQL, no template-built queries; standard Prisma `findFirst` with a literal object where-clause.
- Supply chain: no `package.json` / `package-lock.json` changes.
- Dangerous ops: none — no migrations, no destructive scripts.
- No security incident found.

## Что хорошо
- Fix is minimal, correct, and verified with a reproducible before/after test run rather than just asserted.
- Test mirrors the existing convention exactly (`expect.objectContaining`), keeping the soft-delete regression suite consistent.
- Correctly resisted scope creep into the sibling functions with the same latent bug — noted as a follow-up rather than smuggled into this PR.
