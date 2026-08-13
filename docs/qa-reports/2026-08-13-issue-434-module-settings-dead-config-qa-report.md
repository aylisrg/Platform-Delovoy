# QA: Issue #434 — openHour/closeHour/maxBookingHours/slotRoundingMinutes/sessionAlertMinutes читаются сервисом

## Вердикт: PASS

Branch: `claude/issue-434-module-settings-dead-config`, HEAD `26858b5` (two commits:
`6e45c6a` main fix + `26858b5` fix for the code-reviewer-found `slotRoundingMinutes`
default mismatch + `DURATION_ABOVE_MAX` HTTP status), diff vs `main`. Verified
independently — re-read the full diff and traced the code by hand, re-ran all gates
myself, did not just re-confirm the two review reports' conclusions.

---

## Regression / build gates (re-run independently)

| Check | Result |
|-------|--------|
| `npm test -- --run` | **214 test files / 3220 tests, all passing** |
| `npx tsc --noEmit -p tsconfig.json` | Clean, no output, exit 0 |
| `npm run lint` | 0 errors, 15 pre-existing warnings — all in `messenger/*`, `modules/messenger/types.ts`, `modules/notifications/service.ts`, `modules/telephony/novofon-client.ts`; none of the files touched by this diff appear in the warning list |

Matches the numbers quoted in both review reports; not taken on faith.

---

## Acceptance criteria (from issue #434's prescribed fix)

| # | AC | Verdict | Evidence |
|---|---|---|---|
| 1 | gazebos `getAvailability`/`getTimeline` read `openHour`/`closeHour` from `Module.config`, not hardcode | PASS | Traced by hand: `getOpenCloseHours()` (`src/modules/gazebos/service.ts:83-92`) does `prisma.module.findUnique({slug: "gazebos"})` → `config?.openHour`/`closeHour` with `typeof === "number"` guard, falling back to `DEFAULT_OPEN_HOUR=8`/`DEFAULT_CLOSE_HOUR=23`. Called and destructured directly into the slot-generation loop in `getAvailability` (`for (let hour = openHour; hour < closeHour; ...)`, line ~1479) and into `Array.from({length: closeHour - openHour}, ...)` in `getTimeline` (line ~1539) — not a passthrough that's computed but discarded. `grep -n "OPEN_HOUR\|CLOSE_HOUR" src/modules/gazebos/service.ts` → only `DEFAULT_OPEN_HOUR`/`DEFAULT_CLOSE_HOUR` and doc-comments remain, confirmed by direct grep in this session. |
| 2 | ps-park `getAvailability`/`getTimeline` read `openHour`/`closeHour` | PASS | Same pattern, `src/modules/ps-park/service.ts:64-73` `getOpenCloseHours()`, applied in `getAvailability` (`for (let hour = openHour; ...)`, ~line 1349) and `getTimeline` (`Array.from({length: closeHour-openHour}, ...)`, ~line 1397), also `extendBooking`'s `BEYOND_CLOSING` check and `getAnalytics`. Grep confirms no remaining bare `OPEN_HOUR`/`CLOSE_HOUR` identifiers in the file. |
| 3 | gazebos `maxBookingHours` applied symmetrically to `minBookingHours` in `createBooking`, `createAdminBooking`, `rescheduleBooking` | PASS | Read all three functions end to end: each has, immediately after the existing `DURATION_BELOW_MIN` check, a new `const maxHours = await getMaxBookingHours(); if (durationHours > maxHours) throw new BookingError("DURATION_ABOVE_MAX", ...)` — verified once per function (lines ~263-269, ~461-467, ~670-676), no place with `minHours` check that's missing the paired `maxHours` check. |
| 4 | ps-park: billing rounding uses `slotRoundingMinutes`, not hardcoded 15 | PASS | `billedHours(startTime, endTime, roundingMinutes)` (service.ts, function at bottom of file) now takes the rounding value as a parameter and computes `Math.ceil(durationMin / roundingMinutes) * (roundingMinutes / 60)`. All 3 call sites (`updateBookingStatus` COMPLETED, `getActiveSessions`, `getBookingBill`) pass `await getSlotRoundingMinutes()` — confirmed by reading each call site, not just grepping the function signature. |
| 5 | ps-park: `sessionAlertMinutes` replaces hardcoded `<= 10` in the active-session card | PASS | `getActiveSessions()` returns `alertMinutes` per session (from `getSessionAlertMinutes()`); `ActiveSession` type extended with `alertMinutes: number`; `active-session-card.tsx:75` now reads `remainingMinutes <= session.alertMinutes` instead of a literal `10`. Verified in the file directly. |
| 6 | Both `timeline-grid.tsx` no longer hardcode `OPEN_HOUR`/`CLOSE_HOUR` | PASS | `grep -n "OPEN_HOUR\|CLOSE_HOUR" src/components/admin/{gazebos,ps-park}/timeline-grid.tsx` (run independently in this session) → only `FALLBACK_OPEN_HOUR`/`FALLBACK_CLOSE_HOUR` constants and their doc-comment remain in both files. Both components derive `openHour`/`closeHour` from `data.hours[0]`/`data.hours[last]` (backend-computed from `Module.config`), falling back to the `FALLBACK_*` constants only when `hours` is empty. Correct: fallback is a defensive UI concern (empty backend response), not a second source of truth for the normal case. |
| 7 | `minBookingHours` (gazebos, the one previously-working setting) not broken | PASS | `getMinBookingHours()` untouched by the diff; all existing `DURATION_BELOW_MIN` tests still pass unmodified inside the green 214/214 run. |
| 8 | Runbook no longer documents the dead setting as a workaround | PASS | `docs/runbooks/booking-operator-guide.md` — the line `"Часы работы в «Настройках» не влияют на сетку | Сетка фиксирована 08:00–23:00, не менять настройки"` is removed (confirmed via `git diff`), no replacement line contradicting the new behavior left behind. |
| 9 | Tests: `getTimeline`/`getAvailability` genuinely respect the setting (not just "doesn't throw") | PASS | Read the actual assertions, not just `describe()` titles. Examples confirmed by direct read: `gazebos/__tests__/service.test.ts:817-828` asserts `result.openHour).toBe(9)`, `result.closeHour).toBe(21)`, `result.maxBookingHours).toBe(6)` with `config: { openHour: 9, closeHour: 21, maxBookingHours: 6 }`; `ps-park/__tests__/service.test.ts:814-845` asserts `withDefault[0].billedHours).toBe(0.75)` (15-min default) vs `withConfigured` (`slotRoundingMinutes: 30`) `.toBe(1.0)` — a real computed-value comparison across two configs, not a "no exception" smoke test. |

All 9 ACs verified PASS by direct code reading in this session, independent of trusting the two prior review reports' line citations.

---

## Billing regression risk (issue's explicit ask: verify bit-for-bit, don't trust the test alone)

Manually re-derived the formula in a standalone Node snippet, comparing the **old**
hardcoded formula (`Math.ceil(durationMin / 15) * 0.25`, taken verbatim from `git show
main:src/modules/ps-park/service.ts`) against the **new** parameterized formula
(`Math.ceil(durationMin / roundingMinutes) * (roundingMinutes / 60)`) at
`roundingMinutes = 15` (the empty-config default), across the issue's requested cases
(`durationMin = 40, 61`) plus additional boundary values:

```
40  old: 0.75  new(15): 0.75  MATCH
61  old: 1.25  new(15): 1.25  MATCH
1   old: 0.25  new(15): 0.25  MATCH
14  old: 0.25  new(15): 0.25  MATCH
15  old: 0.25  new(15): 0.25  MATCH
16  old: 0.5   new(15): 0.5   MATCH
59  old: 1     new(15): 1     MATCH
60  old: 1     new(15): 1     MATCH
90  old: 1.5   new(15): 1.5   MATCH
121 old: 2.25  new(15): 2.25  MATCH
900 old: 15    new(15): 15    MATCH
```

Bit-for-bit identical at every tested value. Given `roundingHours = roundingMinutes/60`
algebraically reduces to `1/4` when `roundingMinutes=15`, this is a general identity, not
a coincidence of the sampled inputs — the formula transformation is provably lossless at
the default.

**Prerequisite for this to hold in prod**: the empty-`Module.config` instance must
resolve `slotRoundingMinutes` to `15`, not `30`. This is exactly what commit `26858b5`
fixed in `GET /api/ps-park/settings` (`defaults.slotRoundingMinutes` was `30`, now `15`,
matching `DEFAULT_SLOT_ROUNDING_MINUTES` in `service.ts`). Independently re-verified
both constants side by side in the current file contents (not just the diff): `route.ts:31`
= `15`, `service.ts` `DEFAULT_SLOT_ROUNDING_MINUTES` = `15`. Match confirmed.

Without commit `26858b5`, the very first admin who saved the ps-park settings form for
*any* unrelated field (e.g. Telegram channel toggle) would have silently persisted
`slotRoundingMinutes: 30` into `Module.config`, and live-session billing would have
jumped from 15-minute to 30-minute rounding increments mid-flight. This class of bug
(exactly the "conflicting sources of truth" issue #434 asked to eliminate) was caught by
`code-reviewer` round 1 and is confirmed fixed in round 2 and by my own independent check
here.

---

## Independent verification beyond re-confirming the two review reports

- **`billedHours()` call sites**: traced all three (`updateBookingStatus` COMPLETED path,
  `getActiveSessions`, `getBookingBill`) by hand — each now passes
  `await getSlotRoundingMinutes()` as the third argument. None left on the old two-arg
  hardcoded-15 signature (which would have been a silent partial-fix — checked for this
  specifically since it's the highest-risk failure mode of this PR).
- **`DURATION_ABOVE_MAX` HTTP status, gazebos public booking routes**: read
  `src/app/api/gazebos/book/route.ts` and `admin-book/route.ts` directly — both call
  `apiError(error.code, error.message)` with no explicit status argument for *any*
  `BookingError` code (both `DURATION_BELOW_MIN` and `DURATION_ABOVE_MAX` get the same
  default `400`). Confirms round 2's claim that there is no asymmetry to fix in these two
  routes — the `unprocessableCodes`/422 pattern only exists in
  `gazebos/bookings/[id]/route.ts` (the `PATCH`/reschedule endpoint), where
  `DURATION_ABOVE_MAX` was correctly added to the `Set` alongside `DURATION_BELOW_MIN`.
- **`minBookingHours` (ps-park) confirmed still dead**, independently: `grep -n
  "minBookingHours" src/modules/ps-park/service.ts` in this session returns zero matches
  — the field is genuinely never read by the service, matching the reviewer's claim and
  the issue's silence on this field. Correctly left out of scope.
- **gazebos `/api/gazebos/settings` route defaults vs `service.ts` `DEFAULT_*`
  constants**: re-checked independently (not just trusting the reviewer's table) —
  `route.ts` `defaults = { openHour: 8, closeHour: 23, minBookingHours: 4,
  maxBookingHours: 8, ... }` against `service.ts` `DEFAULT_OPEN_HOUR=8,
  DEFAULT_CLOSE_HOUR=23, DEFAULT_MIN_BOOKING_HOURS=4, DEFAULT_MAX_BOOKING_HOURS=8`. All
  four match byte-for-byte. No second instance of the same class of bug in gazebos.
- **UI grid public data exposure**: `AvailabilityResponse` now additionally returns
  `maxBookingHours`, `openHour`, `closeHour` to any caller of the public availability
  endpoint. These are non-sensitive operational numbers (already effectively public via
  the visible booking grid), not PII/secrets — no new data-leakage surface.

---

## Security functional checks (relevant subset)

- **RBAC**: no endpoint's auth/role gating changed. `/api/ps-park/settings` (GET/PATCH)
  still gated by `requireAdminSection(session, "ps-park")`; `/api/gazebos/bookings/[id]`
  (PATCH/reschedule) unchanged apart from the `unprocessableCodes` Set addition — the
  auth check above it in the same file is untouched. All service functions consuming the
  new config getters (`createBooking`, `createAdminBooking`, `rescheduleBooking`,
  `extendBooking`, `getActiveSessions`, `getBookingBill`) are called exclusively from
  already-RBAC-protected routes, none of which are in this diff.
- **AuditLog**: `PATCH /api/ps-park/settings` still writes `module.settings.update` with
  `before`/`after` config snapshot — unaffected by the default-value fix (a comment-only
  change to the literal plus the value itself).
- **Injection**: only `prisma.module.findUnique({ where: { slug } })` — parameterized,
  no raw SQL introduced.
- **Secrets/data leakage**: `git diff main...HEAD | grep -niE
  '(password|token|secret|NEXTAUTH|TELEGRAM_.*TOKEN|api[_-]key)'` (re-run independently in
  this session, not trusted from the review report) — no matches in code changes.
- **Supply chain**: `package.json`/`package-lock.json` not touched.

No security-case FAIL found for the changes in this diff.

---

## Scope check

13 files changed (`git diff main...HEAD --stat`, confirmed): `gazebos/service.ts`,
`gazebos/types.ts`, `gazebos/__tests__/service.test.ts`, `ps-park/service.ts`,
`ps-park/types.ts`, `ps-park/__tests__/service.test.ts`, both `timeline-grid.tsx`,
`active-session-card.tsx`, `ps-park/settings/route.ts`,
`gazebos/bookings/[id]/route.ts`, `booking-operator-guide.md`, plus the round-1 review
report added in commit `26858b5`. All within gazebos + ps-park + their tests/UI/docs —
no new module, no unrelated refactor, `package.json` untouched. Matches the issue's
description exactly.

### Deliberate out-of-scope decisions — assessed as reasonable, not missed bugs

- **ps-park `minBookingHours`**: never read by the service before or after this PR
  (independently confirmed above via grep). Issue #434 does not name this field as
  broken (it names `openHour`/`closeHour`/`maxBookingHours`/`slotRoundingMinutes`/
  `sessionAlertMinutes` explicitly, plus generically "minBookingHours [gazebos] is the
  only one that worked" — referring to the *gazebos* field, not ps-park's field of the
  same name). Leaving ps-park's dead `minBookingHours` untouched is a defensible reading
  of the issue's literal scope, not scope creep in reverse. Agree this is fine to leave
  for a separate ticket if/when it's noticed as a problem in its own right.
- **"Three conflicting sources of hours" (settings vs seed `workingHours` vs JSON-LD)**:
  issue #434 names this as a *symptom* of the broader problem, and the prescribed fix
  ("apply everywhere OR remove the fields") is specifically about the admin settings
  form vs backend services — not about public-page marketing copy / structured data.
  Follow-up issue #520 is claimed by both review rounds to track the remaining
  discrepancy; I could not independently confirm #520 exists on GitHub in this session
  (no `gh` CLI or GitHub MCP tool available to me here), so I'm not vouching for the
  issue number itself, but the underlying decision — that public-page JSON-LD/seed text
  is a distinct concern from "admin settings form lies about what it controls" — is
  sound scope-boundary reasoning regardless of whether #520 specifically exists yet.
  Confirmed no changes touch `src/app/(public)/gazebos/page.tsx` or `scripts/seeds/` in
  this diff, consistent with that boundary being held.

---

## Process note (non-blocking, does not affect verdict)

`docs/qa-reports/2026-08-13-issue-434-module-settings-dead-config-review.md` at `HEAD`
(commit `26858b5`) contains **only round 1** (129 lines, `git show HEAD:<path> | wc -l`).
The round-2 PASS section (93 additional lines, present in the working tree at the start
of this QA pass and quoted in the task brief) is **uncommitted** — `git status --short`
shows this file as locally modified, not part of any commit on this branch. This means
the round-2 review verdict that formally supersedes round 1's NEEDS_CHANGES is not
currently persisted in git history on this branch; anyone re-cloning/re-checking-out
`claude/issue-434-module-settings-dead-config` today would see only the NEEDS_CHANGES
round in the repo. Recommend the round-2 content be committed (e.g. squashed into
`26858b5` is no longer possible without amending history that's presumably already
pushed/reviewed — a new small commit appending it is the safe option) before merge, so
the audit trail is complete in git, not just in this session's working tree. This is a
documentation/process gap, not a code defect — it does not change the PASS verdict on the
code itself, which I verified independently of trusting either review document's prose.

---

## Manual QA to double-check post-merge (cannot click through the real admin UI from here)

1. In `/admin/gazebos/settings` and `/admin/ps-park/settings`: change `openHour`/
   `closeHour` and save, then open `/admin/gazebos/bookings` and `/admin/ps-park/bookings`
   timeline grids and visually confirm the grid's rendered hour range actually shifts to
   match the new setting (the code traces correctly per this report, but rendering/CSS
   layout of the shifted grid — column widths, "now" marker position at edge hours — has
   not been visually exercised).
2. With a real active PS Park session close to expiry, set `sessionAlertMinutes` to a
   custom value (e.g. 20) in settings, and visually confirm the active-session card
   actually flips to its "ending soon" visual state (color/badge) at the configured
   threshold rather than the old fixed 10-minute mark — unit tests confirm the boolean
   logic (`remainingMinutes <= session.alertMinutes`) but not the rendered UI transition.
3. Save the ps-park settings form once in a real (non-unit-test) staging environment with
   an empty prior `Module.config`, then confirm via `getBookingBill`/an active session's
   displayed total that billing did NOT silently change increments — a live smoke test of
   the exact regression this PR's second commit was written to prevent.

This is the standard "no live browser verification" gap already flagged as an agent
limitation in prior QA reports in this repo — not a defect found in this pass, just the
residual manual-QA surface for the repo owner, explicitly requested to be called out by
the task brief (item 6).

---

## Тест-план (сводка)

### Скоуп
`getAvailability`/`getTimeline`/`createBooking`/`createAdminBooking`/`rescheduleBooking`
(gazebos) и `getAvailability`/`getTimeline`/`extendBooking`/`getActiveSessions`/
`getBookingBill`/`updateBookingStatus` (ps-park) — все должны читать
openHour/closeHour/maxBookingHours/slotRoundingMinutes/sessionAlertMinutes из
`Module.config` вместо хардкода; UI-гриды и карточка активной сессии должны отражать
настройки, а не собственные константы.

### Тест-кейсы (соответствуют AC 1-9 выше)

#### TC-1: gazebos getAvailability/getTimeline уважают openHour/closeHour/maxBookingHours
- **Приоритет**: Critical
- **Тип**: Functional (unit-level, mocked Prisma) — верифицировано вручную трассировкой кода
- **Статус**: Pass

#### TC-2: gazebos createBooking/createAdminBooking/rescheduleBooking отклоняют бронь длиннее maxBookingHours
- **Приоритет**: Critical
- **Тип**: Functional
- **Статус**: Pass — все три места симметричны minBookingHours-проверке

#### TC-3: ps-park getAvailability/getTimeline/extendBooking уважают openHour/closeHour
- **Приоритет**: Critical
- **Тип**: Functional
- **Статус**: Pass

#### TC-4: ps-park billedHours() уважает slotRoundingMinutes, дефолт бит-в-бит совпадает со старым хардкодом
- **Приоритет**: Critical (billing correctness)
- **Тип**: Functional / Regression — верифицировано вручную формулой на нескольких значениях
- **Статус**: Pass

#### TC-5: ps-park active-session-card уважает sessionAlertMinutes
- **Приоритет**: High
- **Тип**: Functional
- **Статус**: Pass (логика; визуальный переход — вне охвата агента, см. Manual QA п.2)

#### TC-6: timeline-grid.tsx (оба модуля) не хардкодят часы
- **Приоритет**: High
- **Тип**: Functional / UI (код), Regression
- **Статус**: Pass (grep + чтение кода; визуальный рендер — вне охвата агента, см. Manual QA п.1)

### Edge cases
- [x] Пустой `Module.config` (типичный прод-инстанс) — покрыто TC-4, дефолт 15 мин, бит-в-бит проверен вручную
- [x] Некорректный/чужеродный тип в `Module.config` (не число) — `typeof val === "number"` guard во всех геттерах, fallback на дефолт
- [x] Превышение maxBookingHours — DURATION_ABOVE_MAX во всех трёх местах, HTTP-статус проверен (422 на reschedule, 400 на create — согласовано с существующим паттерном)
- [ ] Rate limiting — не применимо, роуты настроек/букинга не в диффе
- [x] RBAC (403 для не-админа на settings) — не менялся, подтверждено вне диффа

### Результат
- Всего кейсов: 6 (плюс независимые находки выше)
- Пройдено: 6
- Провалено: 0
- Заблокировано: 0 (кроме визуальных проверок UI, вынесенных в Manual QA)

---

## Итог

Оба круга `code-reviewer` (NEEDS_CHANGES → PASS) верны по существу: блокирующая находка
первого круга (расхождение дефолта `slotRoundingMinutes` между `route.ts` и `service.ts`)
реально устранена во втором коммите, и я независимо подтвердил это через прямое сравнение
файлов и ручной расчёт формулы биллинга на нескольких значениях, а не приняв заявление на
веру. Все 9 acceptance criteria issue #434 выполнены и прослежены по коду вручную. Тесты,
typecheck и lint зелёные (перепрогнаны самостоятельно). Решения не трогать ps-park
`minBookingHours` и публичные JSON-LD/seed-источники часов — обоснованные границы скоупа.
Единственная находка этого прохода — процессная, не кодовая: файл отчёта ревью на диске
опережает git-историю (round 2 не закоммичен) — рекомендуется закоммитить перед мержем,
но это не блокирует вердикт по коду.

**Вердикт: PASS.**
