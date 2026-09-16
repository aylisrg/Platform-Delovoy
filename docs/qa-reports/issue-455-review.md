# Review: CRITICAL-alert email fallback (issue #455)

## Вердикт: PASS

Branch `claude/issue-455-critical-email-fallback` diffed against the current
`origin/main` (local `main` was stale by 2 commits; re-pointed before diffing
to exclude unrelated already-merged commits). True diff is exactly 4 files:
`src/lib/notifications.ts`, `src/lib/__tests__/notifications.test.ts`,
`.env.example`, `CLAUDE.md`.

## Acceptance Criteria (from issue description, no PRD required — see Scope Check)
| AC | Статус | Комментарий |
|----|--------|-------------|
| `sendAlert()` falls back to email only when level is CRITICAL | PASS | `if (telegramOk \|\| level !== "CRITICAL") return telegramOk;` — non-CRITICAL always returns immediately, identical to pre-PR behavior. |
| Fallback triggers on Telegram failure (`res.ok:false`) or Telegram unconfigured | PASS | Both paths converge on `telegramOk = false`, single fallback branch handles both. |
| `CRITICAL_ALERT_EMAIL` unset → behavior unchanged (returns `false`) | PASS | `if (!fallbackEmail) return false;` — matches pre-PR return value for the "not configured" case. |
| No double-send when Telegram succeeds | PASS | `telegramOk` true → early return before any email code runs. |
| Reuses existing `sendTransactionalEmail` (no new SMTP code) | PASS | Imports from `src/modules/notifications/channels/email.ts`, no duplication. |
| `.env.example` documents new vars | PASS | `CRITICAL_ALERT_EMAIL` + previously-undocumented `SMTP_HOST/PORT/USER/PASS/FROM`, with accurate comments (console-log fallback behavior correctly described). |
| CLAUDE.md monitoring table updated | PASS | One-line, accurate addition to the CRITICAL row. |

### Branch-by-branch trace (requested in task)
Verified by reading `src/lib/notifications.ts` line-by-line plus the 12
existing+new tests in `notifications.test.ts` (ran independently:
23/23 pass in `notifications.test.ts` + `logger.test.ts`; full suite
327 files / 4562 tests, matches the claimed 4562/4562):

- Telegram configured + succeeds + CRITICAL → `telegramOk=true`, returns `true`, email never called. Test: "Telegram работает → email-фолбэк не трогаем".
- Telegram configured + fails + CRITICAL + email set → falls to email, returns `emailResult.success`. Test: "Telegram send вернул ok:false + email настроен".
- Telegram configured + fails + CRITICAL + email unset → same code path as "unconfigured + email unset" (`if (!fallbackEmail) return false`), not given its own dedicated test but the branch is identical code to the tested "unconfigured" variant — not a real gap.
- Telegram unconfigured + CRITICAL + email set → falls to email. Test: "Telegram не настроен + CRITICAL_ALERT_EMAIL задан".
- Telegram unconfigured + CRITICAL + email unset → `false`, email never attempted. Test: "тоже не задан → false, email не пытается".
- Any config + non-CRITICAL → returns `telegramOk` immediately regardless of email config, matches pre-PR contract exactly (see "Backward compatibility" below). Test: "уровень не CRITICAL... email-фолбэк не применяется" (covers the unconfigured-Telegram variant; the configured-and-failed variant runs through the identical `if (telegramOk || level !== "CRITICAL")` line, so it's not a meaningfully distinct branch).
- Email fallback itself fails (`{success:false}`) → returns `false`, no false-positive success. Test: "email fallback сам не удался → false".

No branch left unhandled, no double-send, no state where a broken alert (neither Telegram nor email actually delivered) is reported as `true`.

## Correctness: unhandled-rejection edge case (task point 4)
`sendTransactionalEmail` (`src/modules/notifications/channels/email.ts`)
wraps `transporter.sendMail()` in its own `try/catch` and always resolves
`{success: boolean, error?}` — it does not throw for the realistic failure
mode (SMTP send error). There is a narrow theoretical gap: if
`nodemailer.createTransport()` inside `getTransporter()` ever threw
synchronously (not observed in practice), that would surface as a *rejected*
promise from `sendTransactionalEmail`, and `sendAlert` has no `try/catch`
around `await sendTransactionalEmail(...)`, so it would propagate as a
rejected promise from `sendAlert` too. This is not a regression: the
pre-existing Telegram call (`await telegramApi(...)`) had exactly the same
property (no try/catch) before this PR, and the only real caller,
`alertCritical()` in `src/lib/logger.ts`, already wraps `await sendAlert(...)`
in its own `try/catch` specifically for this reason ("Ошибка отправки не
должна ронять вызывающий код"). So end-to-end there's no crash risk today.
Suggestion (non-blocking): add a test with
`mockSendTransactionalEmail.mockRejectedValue(...)` to document this
contract explicitly, since the task correctly flagged it as untested.

## Backward compatibility
Confirmed `sendAlert` has exactly one call site in the codebase for INFO/
WARNING/ERROR/CRITICAL (`src/lib/logger.ts`'s `alertCritical`, itself only
invoked for CRITICAL via `log.critical`). A separate, unrelated `sendAlert`
exists in `bot/index.ts` (used by `scripts/health-check.ts` for INFO/ERROR
health-check alerts) — that is a different function, untouched by this diff,
not affected. For the levels this `sendAlert` *is* called with in practice
today (only `CRITICAL`), the new code is behavior-identical to before when
`CRITICAL_ALERT_EMAIL` is unset (`false`, same as before) and strictly
additive when it is set. The four pre-existing tests in
`notifications.test.ts` are byte-identical to before the PR and still hold
their original meaning (verified via `git show main:...` diff): three assert
`false`-with-no-Telegram-call, one asserts correct `chatId` routing — none
of these was weakened or reinterpreted to pass artificially.

## HTML/email-injection question (task point 2)
Confirmed by reading `src/lib/logger.ts`: `alertCritical()` calls
`escapeHtml(source)` / `escapeHtml(message)` **before** calling `sendAlert`,
and this escaping happens centrally inside `alertCritical` — every caller of
the public `log.critical()` convenience function gets this for free; no
individual call site needs to remember to escape. `sendAlert` itself does
**not** escape internally and its own JSDoc doesn't state escaping as a
prerequisite (only `logger.ts`'s comment above `alertCritical` documents the
requirement). Today this is safe because `sendAlert` has exactly one caller.
Reusing the already-HTML-escaped `text` string for both the Telegram body and
the new email body (`\n`→`<br>` for HTML, `<[^>]+>` strip for plain text) is
correct given escaped input: escaped `<`/`>` become `&lt;`/`&gt;` and won't
match the tag-strip regex, so only the template's own literal `<b>`/`<i>`/
line breaks get processed — no unescaped user content leaks into either
output.
Risk noted for the record, not blocking: if a future caller invokes
`sendAlert` directly with unescaped content at CRITICAL level, it would leak
into the email HTML body the same way it already can into the Telegram
message today (this is a pre-existing architectural property of
`sendAlert`, not something this PR introduces — the PR just extends an
already-implicit "caller must escape" contract to a second output channel).
Suggestion (non-blocking): add a one-line note to `sendAlert`'s own JSDoc
(not just `logger.ts`'s) that `source`/`message` are trusted verbatim into
both a Telegram HTML message and an email HTML body.
Also verified: `subject: \`[${level}] ${source}\`` cannot be used for SMTP
header injection because `source` in every current call site is a `source:
EventSource` value — a closed TypeScript string-literal union
(`src/lib/event-sources.ts`), not free-form/user-controlled text, so CRLF
injection into the subject header isn't reachable today. `message` (which
could contain user-influenced text, e.g. a feedback name per the comment in
`logger.ts`) only ever lands in the body, not the subject.

## Scope Check
- Scope creep: Нет
- No new module (`src/modules/{slug}/`) created; extends the existing
  `src/lib/notifications.ts` and reuses the existing
  `src/modules/notifications/channels/email.ts` adapter unchanged. Per
  CLAUDE.md's scope guard, a PRD is required only for new modules — a
  targeted reliability fix tied to an issue (#455) doesn't need one, and
  none of the added code is unrelated to that issue.
- No unrelated refactoring, no incidental file touches. `.env.example` and
  `CLAUDE.md` edits are the minimum required doc sync for the new env var
  and the changed monitoring behavior (CLAUDE.md rule #4).
- Confirmed the diff does **not** include `.github/workflows/ops-nginx.yml`,
  `scripts/local-watchdog.sh`, `CHANGELOG.md`, or `package.json`/
  `package-lock.json` changes that appeared in an initial (stale) local
  `main` diff — those are unrelated commits already on `origin/main` that
  the branch is based on top of, not part of this PR. Re-verified with
  `git branch -f main origin/main` before diffing.

## Качество кода
- TypeScript strict: OK (`tsc --noEmit` clean, no `any` introduced)
- Zod валидация: N/A (no new user input surface — internal lib function, env vars only)
- API формат: N/A (not a route handler / no `apiResponse`/`apiError` involved)
- Тесты: OK — 8 new tests added, all target branches from the AC table exercised; full suite 4562/4562 green, independently reproduced

## Безопасность

### Security
- **Secrets leakage:** No token/secret values logged (only `res.description` / `emailResult.error` messages, no credentials). `grep -riE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` on `src/lib/notifications.ts` only matches the expected `TELEGRAM_BOT_TOKEN` env-var *name* being read, not any value being emitted. `.env.example` values are placeholders/defaults (`smtp.yandex.ru`, empty user/pass), no real credentials committed. No `.env*` file added to git.
- **RBAC:** N/A — internal server-side alerting function, no new API endpoint, no user-facing surface.
- **Injection:** No SQL/Prisma raw queries. HTML/email-header injection analyzed above — not exploitable today (source is a closed enum, escaping is centralized for the only real caller); flagged one non-blocking hardening suggestion (JSDoc contract note) for future callers.
- **Supply chain:** No new dependencies — `nodemailer` was already a direct dependency (`^7.0.7`) used by the pre-existing email channel; `package.json`/`package-lock.json` are untouched by this diff.
- **Dangerous ops:** None — no destructive scripts, no migrations, no `rm -rf`/force-push in the diff.

No security incident found. Verdict is unaffected by section 6 of `agents/SECURITY.md` (nothing to escalate).

## Что хорошо
- Minimal, surgical diff exactly scoped to issue #455 — no scope creep.
- Correctly identified and reused the existing self-contained SMTP adapter instead of building a parallel one.
- Non-CRITICAL behavior is provably unchanged (traced code path, not just tested).
- Good test coverage of the actual decision matrix (Telegram ok/fail/unconfigured × email set/unset), including the "email fallback itself fails" case that's easy to skip.
- Doc sync (CLAUDE.md + `.env.example`) done in the same PR as required by Scope guard #4.
- Reused `text` string correctly accounts for the pre-escaped nature of its content when converting to HTML/plain-text email bodies — no re-escaping bugs or double-encoding.

## Незначительные предложения (не блокируют PASS)
1. Add a `mockRejectedValue` test case for `sendTransactionalEmail` in `notifications.test.ts` to make the "won't crash the caller" property explicit and regression-proof, since it currently relies on `logger.ts`'s outer `try/catch` rather than anything in `sendAlert` itself.
2. Add a short JSDoc line directly on `sendAlert` (not just the surrounding comment in `logger.ts`) stating that `source`/`message` must be pre-escaped by the caller, since they now feed both a Telegram HTML message and an email HTML body.
