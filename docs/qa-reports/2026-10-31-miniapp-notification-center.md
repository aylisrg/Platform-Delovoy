# Mini App: discoverable notification center

## Request and cause

The center was a staff-only secondary card below service shortcuts, and weekly business-report controls existed only inside a separately linked analytics page. The center itself never offered that subscription. The fix makes the center the first card below the main-screen greeting for everyone, and places the authorized weekly setting directly in it.

No cache defect was established: the existing service worker uses network-first Mini App navigation, network-only APIs, and hashed static assets. A browser already displaying an older loaded document still needs a navigation/reopen to fetch newly deployed code. No cache/security configuration changed.

## Behavior and access

- `/webapp` → prominent center → `/webapp/notifications`.
- Personal booking/order/reminder/channel controls use the same extracted component and existing preference API as `/webapp/settings`; existing values are preserved.
- Only SUPERADMIN or ADMIN with analytics sees the business entry; the subscription API independently rechecks current database roles/grants. USER/MANAGER/ungranted ADMIN do not request business data/settings. The center never loads financial aggregates.
- Weekly subscription starts OFF, only explicit PUT changes it, and a missing Telegram connection blocks new opt-in while allowing opt-out. Schedule remains Monday after 09:00 Europe/Moscow for the preceding week.
- Lost PUT responses are reconciled with GET. If the result remains unknown, another write is blocked until refresh. Revoked access removes the control.
- Staff release subscriptions remain `system.release`, with their existing audience, channel and opt-out rules. “Обновления платформы” is reachable from the top of the center.
- Explicit links and Telegram native BackButton return to the center/home. Handlers are replaced/removed on navigation and wait for SDK bootstrap.

## Verification

Local synthetic transport fixtures on the actual Next.js Mini App: 7 Playwright scenarios passed, covering main-screen discovery, persisted on/off across reload, report navigation/back, ordinary preferences, role-negative visibility/request assertions, revoked access, delayed SDK, and 320/390px overflow. Fixtures create no real sessions, accounts, reports or messages. UI unit tests cover unknown write outcomes and missing Telegram. Existing role/subscription API tests: 100 passed; independent business security regression suite: 74 passed.

Independent UI reviewer found two edge cases (lost response, delayed SDK back button); both fixed and rereviewed PASS. Designer inspected staff home/center and ordinary-user center: PASS. The same 7 scenarios also passed against a local production build; its screenshots omit the development indicator. Final exact-commit CI artifacts must be inspected separately. Final local suite: 5945 tests in 439 files passed. Release/API tests (69, including actual workflow normalization and jq fallback cases), TypeScript, ESLint (0 errors; existing/data-loading warnings), YAML/shell validation and whitespace checks passed. Final exact commit, CI and deployment evidence are recorded in the PR.

Release-delivery diagnosis and safe curated-update policy are documented separately with the release changes. No historical re-send, role grant, subscription auto-enable, guessed Telegram recipient or credential change is part of this work. A real-account authenticated production check and the requested personal Telegram test remain pending verified account identity; CI transport fixtures are not evidence of personal receipt.
