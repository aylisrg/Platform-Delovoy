# QA: CRITICAL-alert email fallback (issue #455)

## Вердикт: PASS

Independent re-verification of branch `claude/issue-455-critical-email-fallback`
against `origin/main` (fetched fresh; local `main` was stale, diffed against
`origin/main` directly). True diff: `src/lib/notifications.ts`,
`src/lib/__tests__/notifications.test.ts`, `.env.example`, `CLAUDE.md` — 125
insertions across 4 files, matches `code-reviewer`'s report
(`docs/qa-reports/issue-455-review.md`).

## Acceptance criteria (from issue #455 description)

| AC | Статус | Комментарий |
|----|--------|-------------|
| Fallback to email only when level is CRITICAL | PASS | `if (telegramOk \|\| level !== "CRITICAL") return telegramOk;` — non-CRITICAL always short-circuits before any email code. Test: "уровень не CRITICAL... email-фолбэк не применяется". |
| Fallback triggers on Telegram failure (`res.ok:false`) or Telegram unconfigured | PASS | Both converge on `telegramOk = false`; single shared fallback branch. Tests: "Telegram send вернул ok:false" and "Telegram не настроен". |
| `CRITICAL_ALERT_EMAIL` unset → behavior unchanged (`false`) | PASS | `if (!fallbackEmail) return false;`. Test: "тоже не задан → false, email не пытается". |
| No double-send when Telegram succeeds | PASS | Early return before email code executes. Test: "Telegram работает → email-фолбэк не трогаем" (asserts `mockSendTransactionalEmail` not called even with `CRITICAL_ALERT_EMAIL` set). |
| Reuses existing `sendTransactionalEmail`, no parallel SMTP code | PASS | Confirmed import from `src/modules/notifications/channels/email.ts`, no new adapter. |
| `.env.example` documents new vars | PASS, with one doc-accuracy nit (see Findings) | `CRITICAL_ALERT_EMAIL` + previously-undocumented `SMTP_HOST/PORT/USER/PASS/FROM`. |
| CLAUDE.md monitoring table updated | PASS | Read in full context (`sed -n '378,392p' CLAUDE.md`) — line reads correctly, doesn't break the table, accurately describes the new behavior. |

## 1. Branch-coverage matrix (re-derived independently, not trusting the review)

Re-read `src/lib/notifications.ts` line-by-line myself (not the review's
summary). Decision points in `sendAlert`:

1. `token && targetChatId` (Telegram configured?) — both true/false exercised (pre-existing tests + new ones).
2. `res.ok` (Telegram send succeeded?) — both true/false exercised.
3. `telegramOk || level !== "CRITICAL"` (early-return gate) — exercised true via telegramOk=true test and via non-CRITICAL test; exercised false via the two CRITICAL+telegramOk=false tests.
4. `!fallbackEmail` (email configured?) — both true/false exercised.
5. `emailResult.success` — both true/false exercised.

Full matrix (Telegram configured × result × level × email configured):

| Telegram | Result | Level | Email cfg | Expected | Verified by |
|---|---|---|---|---|---|
| yes | ok | CRITICAL | set | `true`, no email | "Telegram работает → email-фолбэк не трогаем" |
| yes | ok | any | n/a | `true`, no email (code path identical regardless of level once telegramOk=true) | trivially same line, covered by pre-existing CRITICAL test; not independently tested for non-CRITICAL but same code path — not a real gap |
| yes | fail | CRITICAL | set | fallback → email result | "Telegram send вернул ok:false + email настроен" |
| yes/no | fail/unconfigured | CRITICAL | unset | `false` | "тоже не задан → false" (unconfigured variant); configured+failed+unset-email is same code path, not separately tested — not a real gap (both hit the identical `if (!fallbackEmail) return false` line with no branching on *why* telegramOk is false) |
| no | — | CRITICAL | set | fallback → email result | "Telegram не настроен + CRITICAL_ALERT_EMAIL задан" |
| no | — | non-CRITICAL | set | `false`, no email attempt | "уровень не CRITICAL, Telegram не настроен" |
| — | — | CRITICAL | set, email fails | `false` | "email fallback сам не удался → false" |

**Correction to the review's count:** the review states "8 new tests"; I
counted the actual diff (`git diff origin/main...HEAD --
src/lib/__tests__/notifications.test.ts`) and it adds exactly **6** new
`it()` blocks (one new `describe` block, 6 cases) plus 2 lines of shared
mock/beforeEach setup — not 8. This is a reporting inaccuracy in the review,
not a test-coverage gap: the 6 tests do hit every meaningfully distinct
branch in the matrix above (confirmed by hand-tracing, not by counting).
Non-blocking.

## 2. `npm test` / `tsc` / lint — reproduced independently

- `npm test -- --run`: **327 test files, 4563 tests, all green.** (Review
  cited 4562 — off by one vs. what I observe right now; `main` is a moving
  target across sessions so small drift is expected and not itself a defect.
  No failures either way.)
- `npx tsc --noEmit`: clean, zero output, zero errors.
- `npm run lint`: **0 errors, 21 warnings**, all in files untouched by this
  diff (`src/components/messenger/*`, `useChatList.ts`,
  `src/modules/messenger/types.ts`, `src/modules/notifications/service.ts`,
  `src/modules/telephony/novofon-client.ts` — mostly `react-hooks/set-state-in-effect`
  and unused-var warnings). None touch `src/lib/notifications.ts` or its
  test file. Matches the claimed "only pre-existing unrelated warnings."

## 3. Real call chain: `log.critical()` → `alertCritical()` → `sendAlert()` → `sendTransactionalEmail()`

Traced `src/lib/logger.ts` directly (not just `sendAlert` in isolation):

```
log.critical(source, message, metadata)
  → void alertCritical(source, message)          // fire-and-forget
      → escapeHtml(source), escapeHtml(message)
      → sendAlert("CRITICAL", escapedSource, escapedMessage[, ownerChatId])
```

With `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ADMIN_CHAT_ID` fully unset and
`CRITICAL_ALERT_EMAIL` set: `sendAlert` hits the `else` branch (console.warn,
`telegramOk` stays `false`), then `telegramOk || level !== "CRITICAL"` is
`false` (level *is* CRITICAL), so it proceeds to
`sendTransactionalEmail({...})`. **Confirmed: the real production call chain
does reach the email adapter**, not just the unit-tested `sendAlert` function
in isolation. `alertCritical`'s own `try/catch` around the whole block means
a rejected promise from `sendTransactionalEmail` (not just a resolved
`{success:false}`) also can't crash the caller — matches the review's
analysis, verified independently by reading `logger.ts:84-105` myself.

### Finding (new, not in the review): misleading `.env.example` comment for partial SMTP config — non-blocking

The new comment says:

> Требует SMTP_* ниже — без них sendAlert() просто вернёт false, как и раньше.

This is only accurate when `CRITICAL_ALERT_EMAIL` itself is unset. Tracing
`sendTransactionalEmail` → `getTransporter()`
(`src/modules/notifications/channels/email.ts:6-21`): if `CRITICAL_ALERT_EMAIL`
**is** set but `SMTP_USER`/`SMTP_PASS` are **not** (exactly the state of the
new `.env.example` defaults — `SMTP_USER=""`, `SMTP_PASS=""`), `getTransporter()`
returns `null`, `sendTransactionalEmail` falls into its `console.log`-only
dev fallback and returns `{success: true}` — so `sendAlert` returns `true`,
**not** `false`, for that partial-config combination. In production this
means: if an operator sets `CRITICAL_ALERT_EMAIL` alone (plausible, since
that's the variable this PR's own doc/CLAUDE.md line calls out) and forgets
`SMTP_USER`/`SMTP_PASS`, the CRITICAL alert is written only to container
stdout — not delivered anywhere a human would see it during an incident —
while `sendAlert` reports success.

Why this is **non-blocking** rather than a FAIL:
- No current consumer branches on `sendAlert`'s return value (`alertCritical`
  discards it, wrapped only for crash-safety) — so no incorrect *application*
  behavior results, only a documentation/operational blind spot.
- The `console.log`-on-missing-SMTP-creds fallback in `sendTransactionalEmail`
  is pre-existing, shared behavior already relied on elsewhere (dev-mode
  magic-link emails etc.) — this PR did not introduce it, it inherited it by
  correctly reusing the existing adapter as instructed by CLAUDE.md.
- It requires a specific partial-misconfiguration to manifest, not the normal
  "both set" or "neither set" paths this PR's tests correctly cover.

Recommend (non-blocking, follow-up acceptable): reword the `.env.example`
comment to say the fallback silently degrades to console-only logging (not
`false`) when `CRITICAL_ALERT_EMAIL` is set without `SMTP_USER`/`SMTP_PASS`,
or have `sendAlert`/the email adapter treat "sent to console only" as
distinguishable from "actually delivered" for this specific alerting use
case. Given the whole point of #455 is making CRITICAL alerts actually
reach a human when Telegram is down, this gap is worth a fast follow-up, but
it is a config-time footgun, not a code defect that breaks a stated AC.

## 4. Code-reviewer's two non-blocking suggestions — my own judgement

Both re-verified by reading the code myself, not just trusting the review:

**(a) No test for `sendTransactionalEmail` rejecting/throwing.**
Confirmed `sendTransactionalEmail` always resolves (its own internal
`try/catch` around `transporter.sendMail()` guarantees this for the
realistic failure mode). The only way it could reject is a synchronous throw
from `nodemailer.createTransport()` inside `getTransporter()`, which is not
observed in practice. Even if it did, `alertCritical`'s own `try/catch`
(pre-existing, unrelated to this PR) already protects the only real caller.
Agree: **genuinely non-blocking** — no crash risk today, and adding the test
is pure hardening/documentation-of-contract, not a correctness fix.

**(b) `sendAlert`'s JSDoc doesn't document the caller-must-escape-HTML contract.**
Confirmed `logger.ts` centrally escapes (`escapeHtml`) before calling
`sendAlert`, and `sendAlert` has exactly one real caller in the codebase
(`alertCritical`). The unescaped-HTML risk is pre-existing (already true for
the Telegram path before this PR) and this PR doesn't create a new unescaped
sink — it just extends the same escaped `text` string to a second output
channel (email), which is provably safe given already-escaped input. Agree:
**genuinely non-blocking** — a documentation nit for future callers, not a
present vulnerability.

I don't elevate either suggestion to blocking. I do add one new observation
of my own (section 3, `.env.example` wording) that the review didn't flag,
but rate it at the same non-blocking severity as the review's two, for the
reasons given above.

## 5. `.env.example` / CLAUDE.md consistency

- No real secrets: `SMTP_USER=""`, `SMTP_PASS=""`, `CRITICAL_ALERT_EMAIL=""`
  are empty placeholders; `SMTP_HOST="smtp.yandex.ru"`, `SMTP_PORT="587"`,
  `SMTP_FROM="noreply@delovoy-park.ru"` are non-secret defaults.
  `noreply@delovoy-park.ru` / `delovoy-park.ru` is the project's own existing
  domain, already used identically elsewhere in the same file
  (`RESEND_FROM_EMAIL="noreply@delovoy-park.ru"`,
  `VAPID_SUBJECT="mailto:admin@delovoy-park.ru"`) — consistent, not a leak.
- `grep`-checked the diff for credential-shaped values (API keys, tokens,
  passwords) — none found beyond the pre-existing `RESEND_API_KEY` placeholder
  format already in the file (untouched by this PR).
- CLAUDE.md's edited monitoring-table line read in full surrounding context
  (`## Monitoring` section, `| Level | Channel |` table) — grammatically and
  factually correct, doesn't clash with the ERROR/WARNING/INFO rows below it.

## Security (functional checklist per `agents/qa.md`)

- **RBAC**: N/A — no new API endpoint, no route handler; `sendAlert` is an
  internal server-side lib function with no user-facing surface.
- **Rate limiting**: N/A — not a public/authenticated endpoint.
- **Input validation**: N/A — no new user input surface; only env vars and
  internal `source`/`message` strings from a closed `EventSource` union
  (verified `src/lib/event-sources.ts` is a TS string-literal union, not
  free-form).
- **Data leakage**: No PII/secrets logged — confirmed via
  `grep -riE '(password|token|secret|TELEGRAM_.*TOKEN)'` on
  `src/lib/notifications.ts`: only the env-var *name* `TELEGRAM_BOT_TOKEN` is
  read, no value ever printed/returned.
- **Verdict on security**: no functional security case applies or fails here
  — this is an internal alerting reliability fix, not a new attack surface.

## Scope

No new module, no unrelated refactor, diff limited to exactly what #455
requires plus the mandated doc sync (CLAUDE.md rule #4). Agrees with the
review's Scope Check.

## Summary

All acceptance criteria verified PASS by independent re-reading of the code
and re-running tests/tsc/lint myself (not by trusting the prior review).
Found one additional non-blocking documentation-accuracy gap (partial-SMTP-config
footgun in the new `.env.example` comment) that the code-reviewer's report
did not mention; judged it non-blocking for the same reasons the review's own
two suggestions are non-blocking (no crash, no incorrect application
behavior, config-time-only). Both of the review's own suggestions are
independently confirmed genuinely non-blocking.

**Вердикт: PASS**
