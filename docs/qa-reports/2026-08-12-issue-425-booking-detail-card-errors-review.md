# Review: booking-detail-card shows errors, completes via bill modal (issue #425) — Round 2 (re-review)

## Вердикт: PASS

Round 2 addresses the single round-1 blocker (lockfile produced with `--legacy-peer-deps`, `npm ci` failing from a clean clone). Functional code from round 1 (already reviewed PASS) is unchanged in this round; verified intact.

## Что изменилось со round 1
1. `0d7e163` — `react-dom` in `dependencies` changed from `^19.2.7` to exact `19.2.7` (matching the existing exact pin on `react`), then `package-lock.json` regenerated without `--legacy-peer-deps`.
2. `78559d4` — trivial comment update in `active-session-card.test.tsx` (flagged non-blocking in round 1, now fixed).

## Round-2 verification (from a clean check)

1. **`rm -rf node_modules && npm ci --ignore-scripts --no-audit --no-fund`** — succeeds, `added 646 packages`, exit 0. Only pre-existing `npm warn ERESOLVE` noise (unrelated `eslint@10` vs `eslint-config-next`'s `eslint-plugin-react`/`eslint-plugin-react-hooks` peer ranges, not touched by this PR) — no fatal `ERESOLVE`/`EUSAGE`. This is what the "Lockfile in sync" CI job runs — confirmed reproducible.
2. **`npx prisma generate` → `npm test` → `npx tsc --noEmit` → `npm run lint`:**
   - `npm test`: 204 test files / 3088 tests, all passing.
   - `npx tsc --noEmit`: clean, no output.
   - `npm run lint`: 0 errors, 15 pre-existing warnings, all in files untouched by this PR (`ChatWindow.tsx`, `useChatList.ts`, `MessageBubble.tsx`, `modules/messenger/types.ts`, `modules/notifications/service.ts`, `modules/telephony/novofon-client.ts` — none touched here, confirmed via `git diff main...HEAD --stat`).
3. **`git diff main -- package.json`:** only dependency-range change is `react-dom`: `"^19.2.7"` → `"19.2.7"`, still under `dependencies` (not moved to `devDependencies`). No other production dependency touched. `devDependencies` additions (`jsdom@^30.0.1`, `@testing-library/dom@^10.4.1`, `@testing-library/react@^16.3.2`, `@testing-library/user-event@^14.6.4`) are unchanged from round 1 — same names/ranges.
4. **Risk assessment of the exact-pin:** minimal and low-risk. It removes a caret so `react-dom` can no longer independently drift to a newer patch than the exact-pinned `react`, which is the root cause class of the original `npm ci` ERESOLVE failure and is arguably a latent correctness improvement (react/react-dom version skew is a known source of subtle bugs), not new risk. Correctly scoped to the round-1 blocker — no unrelated dependency churn beyond transitive lockfile updates that `npm install` regenerated deterministically.

`git diff main...HEAD --stat` confirms the full changeset across both rounds is exactly the two component files, two new test files, one comment fix, and `package.json`/`package-lock.json` — no scope creep introduced in round 2.

## Scope Check
- Scope creep: Нет
- Round 2 touches only `package.json`, `package-lock.json`, and one test comment — exactly the round-1 blocker plus the flagged non-blocking nit. No functional code changed.

## Качество кода
- TypeScript strict: OK (`tsc --noEmit` clean)
- Тесты: OK (3088/3088 passing, including the two new `booking-detail-card.test.tsx` files from round 1)
- Lint: OK (0 errors; pre-existing warnings elsewhere, unrelated to this PR)

## Security
- Secrets leakage: none — `grep -rEi '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` across all files touched in this PR (both rounds) returns nothing.
- `.env*`: not touched.
- Supply chain: the only dependency change is tightening an existing production dependency's version range (`react-dom` caret removed to match `react`'s existing exact pin) — reduces drift risk, does not add a new package. `devDependencies` additions (`jsdom`, `@testing-library/*`) were already reviewed and approved in round 1 (standard, well-maintained, MIT-licensed testing libraries, no typosquat concern).
- RBAC / injection: not applicable to this round's changes (lockfile + comment only); round-1 functional review already covered the component-level fetch/PATCH calls (no new API endpoints, no RBAC surface changed).
- No security incidents found.

## Что хорошо
- Root-caused the exact ERESOLVE trigger (caret on `react-dom` vs. exact pin on `react`) instead of just re-adding `--legacy-peer-deps` to CI, which would have masked the underlying version-skew risk.
- Cleaned up the round-1 stale-comment nit in the same pass.
- Changeset stayed minimal — no opportunistic dependency bumps beyond what was needed to fix the resolver conflict.

Ready to hand to QA.
