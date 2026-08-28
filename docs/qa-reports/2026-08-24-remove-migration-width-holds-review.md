# Review: Remove migration/width holds from auto-merge gate (PR #761) — re-review

## Вердикт: PASS

Follow-up review of commit `9599e6a` (previous pass on `e002227` returned
NEEDS_CHANGES for two doc-drift issues). Both required fixes verified fixed;
no regressions introduced.

## Verification of requested fixes

1. **`DEVELOPMENT-RULES.md:82`** — now reads: "Ручного мержа (кнопкой в
   Telegram) требует только один класс: PR, трогающий рубильники самой
   автоматики (...) — деструктивные миграции и широкие PR больше не держат
   мерж, риск принят владельцем явно (ADR `2026-08-24-remove-migration-width-
   holds-adr.md`)." Correctly reflects shipped gate behavior: only the
   automation-switches hold remains; destructive migrations and wide PRs are
   `auto`-tier. FIXED.

2. **`.github/workflows/issue-queue-merge.yml:18-24`** (top comment block) —
   now reads: "Владелец остаётся ровно там, где нужно именно его решение:
   рубильники самой автоматики (деструктивные миграции и широкие PR больше не
   держат PR — риск принят явно, ADR 2026-08-24-remove-migration-width-holds)."
   No longer lists destructive migrations as a separate owner-decision area.
   FIXED. Diffed the whole file (`git diff e002227..9599e6a -- .github/
   workflows/issue-queue-merge.yml | grep '^[+-]' `, excluding comment lines) —
   confirmed zero non-comment changes; no functional/trigger/permissions drift
   introduced alongside the doc fix.

3. **Optional pointer notes** (previously flagged as minor, not blocking) —
   both landed as suggested:
   - `docs/architecture/2026-08-11-backlog-intake-adr.md:97-99` — updated to
     "гейт (рубильники — hold; деструктивные миграции таким слоем больше не
     являются — риск принят явно, ADR 2026-08-24-remove-migration-width-
     holds)".
   - `docs/architecture/2026-08-14-autonomous-dev-pipeline-audit.md:53` —
     updated to frame the old hold list as "на момент этого аудита" with an
     explicit pointer forward: "с ADR 2026-08-24-remove-migration-width-holds
     остались только рубильники."

## Diff scope check

`git diff e002227..9599e6a --stat` — exactly the 4 files claimed, nothing
else:
```
 .github/workflows/issue-queue-merge.yml                          | 14 ++++++++------
 DEVELOPMENT-RULES.md                                              |  2 +-
 docs/architecture/2026-08-11-backlog-intake-adr.md                |  5 +++--
 docs/architecture/2026-08-14-autonomous-dev-pipeline-audit.md     |  2 +-
 4 files changed, 13 insertions(+), 10 deletions(-)
```
Doc-only / comment-only follow-up commit, as expected.

## Dangling reference check

`grep -rn "DESTRUCTIVE_SQL\|destructiveSqlIn\|moduleOf\|WIDE_PR_"` across the
repo returns only:
- `docs/architecture/2026-08-24-remove-migration-width-holds-adr.md` — the ADR
  itself, correctly using these identifiers in past tense to describe what was
  *removed* from `scripts/lib/issue-queue.ts` (dead-code cleanup record, not a
  live claim).
- `docs/architecture/2026-08-10-autonomous-issue-cleanup-adr.md:266` — an
  older ADR's historical implementation note from 2026-08-10, predating this
  PR and outside its diff/scope; it documents what was true at the time and is
  superseded by the newer ADR, which is cross-referenced from all four files
  actually touched by this PR. Not something this follow-up commit was asked
  to fix, and not misleading in context (no file claims this is *current*
  behavior without the newer ADR being reachable from it).

No reintroduced dangling references in files this PR is responsible for.

## Full PR context

Per instructions, the underlying gate-logic change in `e002227` (removing the
destructive-migration and wide-PR hold classes from
`scripts/lib/issue-queue.ts`) is treated as the already-approved,
out-of-scope-for-objection decision. This pass only re-verifies the two
required doc-drift fixes plus the two optional pointer additions.

## Качество кода
- TypeScript strict: OK (`npx tsc --noEmit` — clean, no output)
- Zod валидация: N/A (no code changed)
- API формат: N/A (no code changed)
- Тесты: OK — `npx vitest run scripts/__tests__/issue-queue.test.ts` → 151
  passed. `npm run lint` → 0 errors, 21 pre-existing warnings unrelated to this
  diff (messenger hooks, unused vars in unrelated modules).

## Scope Check
- Scope creep: Нет — commit touches exactly the 4 files flagged/discussed,
  nothing else.
- Лишние изменения: нет

## Security
- Secrets leakage: `git diff e002227..9599e6a | grep -iE
  '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` → no matches.
  No `.env*` touched.
- RBAC: N/A — no endpoint/code changes in this follow-up commit.
- Supply chain: no dependency changes.
- Injection: N/A — no code changes.
- Dangerous ops: workflow file diff confirmed comment-only (no `on:`, `jobs:`,
  `permissions:`, or step-logic lines changed) — zero functional/security
  surface change in `issue-queue-merge.yml`.
- No security incident found in this follow-up commit.

## Что хорошо
- Both required fixes are textually precise and consistent with the shipped
  gate behavior (single remaining hold class = automation switches).
- The optional pointer-note additions were also applied, improving
  discoverability of the superseding ADR from the two related architecture
  docs.
- Follow-up commit stayed strictly scoped to the 4 flagged locations — no
  drive-by changes, no code touched, tests/lint/tsc all clean.
