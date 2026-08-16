# Review: Комментарий и email в quick-форме бронирования (issue #665, US-1 of Epic #442)

## Вердикт: PASS

Branch `claude/issue-665-comment-email-quick-form` (commit `0937028`) vs `main`. 26 files changed, 15 production + 11 test files, exactly matching the scope enumerated in the task (types, validation, service, admin-book routes, `booking/history.ts`, 4 form components × 2 modules, 2 detail cards, and their tests). No unrelated files touched.

---

## Acceptance Criteria

| AC | Статус | Комментарий |
|----|--------|-------------|
| AC-1 | PASS | `quick-booking-popover.tsx` (gazebos + ps-park) both render a `<textarea maxLength={500}>` "Комментарий (необязательно)", included in POST body only when non-empty. |
| AC-2 | PASS | `mobile-booking-sheet.tsx` (gazebos + ps-park) render the identical comment field; reset alongside `clientName`/`clientPhone` in the sheet-reopen `useEffect`. Desktop/mobile parity confirmed. |
| AC-3 | PASS (with a minor UX nuance, not a functional gap) | Both forms/modules render `<input type="email">` "Email (необязательно)". Server-side format enforcement: `adminCreateBookingSchema`/`adminCreatePSBookingSchema` both use `z.string().email("Некорректный email").max(200).optional()` — a malformed email is rejected with a 400 whose message the UI surfaces via `setError`. Desktop popovers additionally get free HTML5 pre-submit blocking because their `<input type="email">` sits inside a real `<form onSubmit={...}>`. Mobile sheets have **no** `<form>` wrapper (`<button type="button" onClick={handleSubmit}>`), so the browser's native constraint validation never fires there — invalid email on mobile is only rejected by the server round-trip, not blocked client-side pre-flight. Functionally this still satisfies the AC text ("некорректный email блокирует отправку с понятной ошибкой") since the booking is never created and the same "Некорректный email" message is shown — but it is a small, unflagged desktop/mobile UX inconsistency worth a follow-up nit, not a blocker. |
| AC-4 | PASS | `adminCreateBookingSchema` (gazebos, `src/modules/gazebos/validation.ts`) and `adminCreatePSBookingSchema` (ps-park, `src/modules/ps-park/validation.ts`) both gained `email`, mirroring the existing public `createBookingSchema` format. |
| AC-5 | PASS | Comment/email land in `Booking.metadata` (`createAdminBooking`, both `service.ts`), are read back in both `booking-detail-card.tsx` (comment pre-existing, email newly added as a `mailto:` block), and now also in "История": `history.ts` gained `case "booking.admin_create"` reading `meta.comment`/`meta.email` from the `logAudit` metadata written in both `admin-book/route.ts` routes. Verified the new `case` was inserted without touching any other `buildDetails` branch or the `default` fallthrough — other unlisted actions are unaffected. |
| AC-6 | PASS | Email is written only to `Booking.metadata.email`, never to `User.email`. `upsertClientByPhone` (`src/modules/clients/service.ts`) — the function that creates/finds the guest `User` row for admin bookings — only ever touches `name`/`source`, never `email`; confirmed by reading its full implementation. No account creation, no auth touchpoint. |
| AC-7 | PASS | Both `comment: z.string().max(500).optional()` and `email: z.string().email(...).max(200).optional()`; UI only includes them in the POST body via `...(x.trim() && { x: x.trim() })`, so omission never blocks booking creation. Confirmed by `service.test.ts` ("не пишет email в metadata, когда не указан") for both modules. |

## Scope Check
- Scope creep: Нет.
- Лишние изменения: нет — diff is exactly the 26 files described (types×2, validation×2, service×2, routes×2, `booking/history.ts`, popover×2, mobile-sheet×2, detail-card×2, + matching tests for every one of those). No new module, no unrelated refactor, no `package.json` change.

## Архитектура
- Business logic stays in `service.ts` (`createAdminBooking` destructures/stores `email`); route handlers only parse → validate (Zod) → call service → `logAudit` → respond. Matches CLAUDE.md convention.
- `email` storage in `Booking.metadata` (not a new column, not `User.email`) is a deliberate, well-reasoned choice — see Security/Architecture note below.
- Two modules' schemas diverge exactly where they already diverged pre-#665 (`clientPhone` required in gazebos, optional in ps-park) and stay identical for the new `email`/`comment` fields — no accidental cross-module divergence.

## Качество кода
- TypeScript strict: OK (`npx tsc --noEmit` clean, no errors).
- Zod валидация: OK — both schemas validated server-side before any DB write; `parsed.data` used throughout (route handlers never touch raw `body`).
- API формат: OK — routes still use `apiResponse`/`apiError`/`apiValidationError` unchanged.
- Тесты: OK — `npm test -- --run` → 286 test files / 3990 tests, all green.

### `logAudit` metadata round-trip (verified directly)
`src/lib/logger.ts:35-55` — `logAudit` does `metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined`. `JSON.stringify` drops object keys whose value is `undefined` entirely (they never round-trip as the string `"undefined"` or `null`). Confirmed empirically that when `comment`/`email` are absent from `parsed.data`, the audit-log metadata object simply omits those keys — `history.ts`'s `if (meta.comment) ...` / `if (meta.email) ...` guards correctly see them as falsy/absent, not literal strings. `history.test.ts`'s new "не показывает пустые Комментарий/Email" test pins this.

### Test quality spot-check
Reasoned through two representative assertions by mentally reverting the corresponding production line:
- `service.test.ts` "не пишет email в metadata, когда не указан": if `...(email && { email })` were reverted to always spread (or the `email` destructure removed and hardcoded), `metadata` would either always contain the key or never contain it regardless of input — either way `.not.toHaveProperty("email")` would flip to failing. Non-tautological.
- `quick-booking-popover.test.tsx` "не отправляет comment/email... когда поля пустые": if `...(comment.trim() && {...})` were replaced with an unconditional `comment: comment.trim()`, the request body would always include `comment: ""`, and `expect(body).not.toHaveProperty("comment")` would fail. Confirms the test pins the intended "omit when empty" behavior, not just "some behavior".

## Безопасность

- **RBAC**: unchanged on both routes — `auth()` → `hasRole(session.user, "MANAGER")` → `requireAdminSection(session, "gazebos"|"ps-park")`, in that order, before any service call. No new endpoint was added; the existing gate is untouched by this diff.
- **Secrets/PII leakage**: `grep -rniE '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` over the full diff → no matches. `email`/`comment` are only ever surfaced through the same admin-only, RBAC-gated surfaces that already exposed `clientPhone`/`clientName` (detail card, history feed, audit log) — no new public-facing exposure.
- **Injection / XSS**: React auto-escapes JSX text content, so the visible `{email}` text is safe by default. The one attribute-injection vector worth checking — `<a href={`mailto:${email}`}>` — was verified empirically: `email` only reaches the DOM if it first passed `adminCreateBookingSchema`/`adminCreatePSBookingSchema`'s `z.string().email()` server-side validation. Tested candidate payloads (`javascript:alert(1)@evil.com`, `a"onmouseover=alert(1)//@evil.com`, `a<script>@evil.com`) against the actual Zod schema in this repo (`zod@^4.4.3`) — all three are rejected by `.email()`. React also HTML-attribute-escapes the string it does render, so there's no way to break out of the `href="..."` attribute even for values that did pass. No XSS/URI-injection path found.
- **Supply chain**: no `package.json`/`package-lock.json` changes in this diff — zero new dependencies.
- **Dangerous ops**: none — no raw SQL, no `$executeRawUnsafe`, no destructive migration (this PR has no migration at all — `email`/`comment` are stored in the pre-existing `Booking.metadata Json?` column).

**No security incident found.**

## Architectural note: `User.email` vs `Booking.metadata.email` (per explicit review request)

Confirmed `User.email String? @unique` in `prisma/schema.prisma:15`. The decision to store the admin-quick-form email exclusively in `Booking.metadata.email` — never touching `User.email` — is architecturally sound and consistent with the pre-existing `comment` storage pattern for the same function. `upsertClientByPhone` (which does create/attach a guest `User` row for admin bookings, keyed by phone) never writes `email`, so there's no risk of a duplicate-email unique-constraint failure from two unrelated guests giving the same address (or a typo).

However, tracing this further surfaced a genuine (not fabricated) downstream gap, worth flagging even though it's correctly out of scope for this specific issue:

- `src/app/api/ps-park/bookings/[id]/pay-online/route.ts` — the "send an online payment link for the remaining bill" flow the PRD's own US-1 motivation names ("иметь контакт для чека, если позже потребуется дистанционная оплата") — resolves the receipt's `customerEmail` from `prisma.user.findUnique({ where: { id: booking.userId } }).email`, i.e. from `User.email`, **not** from `booking.metadata.email`. Since `createAdminBooking` never writes to `User.email`, an email captured via this new quick-form field is invisible to that flow: `customerEmail` will resolve to `null` and the 54-ФЗ receipt falls back to `customerPhone` only.
- The public guest checkout (`createBooking` in `gazebos/service.ts`) has the same characteristic in the opposite direction: `input.email` is consumed transiently at `resolvePaymentContact()` for that one online-payment call and is **also** never persisted to `booking.metadata` — so "used for the receipt, analogous to the guest flow" (AC-6's wording) is true only in the narrow sense that neither path treats email as a login mechanism; it is not true in the sense of "this email will actually reach a receipt later."

None of AC-1 through AC-7 literally requires wiring the new field into `pay-online`/`createOnlinePayment`, so this is **not a basis for NEEDS_CHANGES** — the task-level PRD note explicitly scopes this out, and the implementation is internally consistent with how `comment` (its direct precedent) has always behaved: captured for human reference in the detail card/history, not machine-consumed elsewhere. But it is a real, not hypothetical, half-satisfied piece of the User Story's own stated value ("контакт для чека... дистанционная оплата") — recommend a short follow-up issue: teach `pay-online` (and any future gazebos equivalent) to fall back to `booking.metadata.email` when `User.email` is null, before this US-1 field is advertised to operators as "useful for online payment."

## Что исправить (если NEEDS_CHANGES)

N/A — no blocking issues found.

## Рекомендации (не блокируют PASS)
1. Consider wrapping `mobile-booking-sheet.tsx`'s email input in a `<form>` (or adding an explicit `input.checkValidity()` guard before `fetch`) so mobile gets the same pre-submit format blocking desktop already has for free via native `<form onSubmit>` — currently mobile only rejects after a server round-trip.
2. Open a follow-up issue to wire `booking.metadata.email` into `pay-online` (`createOnlinePayment`'s `customerEmail`) as a fallback when `User.email` is null, so the email captured here actually reaches a 54-ФЗ receipt when a manager later triggers online payment on an admin-created booking — currently it doesn't (see architectural note above).

## Что хорошо
- Clean mirrored diff across both modules — validation/types/service/route/UI changes are byte-for-byte parallel between gazebos and ps-park, matching the PRD's "identical behavior across modules" requirement.
- Storage-pattern reuse (`...(x && { x })` in `metadata`) is consistent with the pre-existing `comment` field rather than inventing a new convention.
- `history.ts` change is minimal and additive — new `case` inserted cleanly, no risk to other actions' `buildDetails` output.
- Test coverage is not superficial: covers schema-level accept/reject, service-level metadata presence/absence, history-feed rendering with/without values, UI submission with/without values, and detail-card display with/without the field — across both modules.
- The decision not to write to `User.email` was independently verified against the schema and against `upsertClientByPhone`'s actual behavior, and holds up.
