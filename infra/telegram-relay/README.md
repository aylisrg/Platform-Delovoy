# Telegram Bot API relay (Cloudflare Worker)

Serverless egress for Telegram, for when the VPS can't reach `api.telegram.org`
directly. **No extra server, no extra IP, free tier.**

## Why this exists

`Telegram Diagnose` returns **`FULL_BLOCK`** from the Timeweb VPS: DNS resolves,
general egress works (`api.github.com` → 200, `ya.ru` → 302), but every fresh
connection *specifically* to `api.telegram.org` times out on both IPv4 and IPv6
(HTTP 000). That is ТСПУ (RU DPI) dropping the Telegram path from the server's
IP, in waves.

The `@DelovoyPark_bot` process seems fine only because its **long-poll keeps one
connection warm** across the waves. Every **notification opens a fresh
connection** and dies the moment it lands in a closed wave — that's the "constant
errors". The extra IP from PR #364 does not help: that fixed the *inbound* site
path (users' "spinner"); this is the *outbound* path to Telegram.

This Worker routes Bot API traffic through Cloudflare's edge, which is **not on
the blocked path**. The VPS makes a normal HTTPS call to Cloudflare (not
Telegram-specific, not blocked); Cloudflare forwards it to Telegram.

```
 app / bot (VPS, RU)  ──HTTPS──▶  Cloudflare Worker (edge)  ──HTTPS──▶  api.telegram.org
        blocked path ✗                        clean path ✓
```

## How it plugs in (zero application code changes)

Every server-side Bot API call already routes through `TELEGRAM_API_ROOT`
(`src/lib/telegram/client.ts` for `app`, grammy `apiRoot` for `bot`). The client
builds `${TELEGRAM_API_ROOT}/bot<token>/<method>`, so the Worker receives
`/<RELAY_SECRET>/bot<token>/<method>` and forwards it verbatim.

## Deploy (~5 minutes)

Prereq: a free Cloudflare account. From this directory:

```bash
cd infra/telegram-relay
npx wrangler login            # opens browser once
npx wrangler deploy           # publishes worker.ts → *.workers.dev
```

Set the secrets (values are never committed):

```bash
# Required — an unguessable prefix. Generate one:
openssl rand -hex 24
npx wrangler secret put RELAY_SECRET        # paste the value above

# Optional but recommended — the digits before ':' in TELEGRAM_BOT_TOKEN.
# Pins the relay to your bot only, so a leaked URL can't be abused.
npx wrangler secret put ALLOWED_BOT_ID      # e.g. 8123456789
```

Wire it into the platform — GitHub → **Settings → Secrets and variables →
Actions**:

```
TELEGRAM_API_ROOT = https://delovoy-tg-relay.<your-subdomain>.workers.dev/<RELAY_SECRET>
```

Then re-run **Deploy to Production** (`deploy.yml`). It syncs the secret into
`/opt/delovoy-park/.env` for **both** `app` and `bot` and restarts them —
no code change, no image rebuild needed.

## Verify

1. **Actions → Telegram Diagnose → Run** → expect **`VERDICT: OK`**
   (network now reaches Telegram via the relay).
2. Admin → Monitoring → per-channel **test** buttons → message arrives.
3. `GET /api/notifications/health` → `botToken.ok = true`, `queue.failedLastHour = 0`.

## Alternatives (not locked into Cloudflare)

`handleRelay(request, env)` in `worker.ts` is a plain Web-standard handler, so
the exact same logic runs on **Deno Deploy** or **Vercel Edge** with only a
different export wrapper. Any of them satisfies `TELEGRAM_API_ROOT`. A
self-hosted relay (nginx/squid on a non-RU box) also works but reintroduces a
server to run — see the runbook in `DEPLOYMENT.md`.

## Security notes

- The bot token transits your own Worker in the request path — this is inherent
  to any Bot API relay. Cloudflare does not log request bodies; do not add any
  logging of the URL/path to this Worker.
- `RELAY_SECRET` keeps the endpoint from being used as an open Telegram proxy;
  `ALLOWED_BOT_ID` additionally pins it to your bot. Rotate `RELAY_SECRET` by
  setting a new value and updating the `TELEGRAM_API_ROOT` secret.
- The relay adds **no new exposure of the token**: anyone who already has the
  token could call `api.telegram.org` directly regardless of this Worker.

## Tests

`__tests__/worker.test.ts` runs under the repo's `npm test` (Vitest): secret
check, path/query forwarding, file-download paths, `ALLOWED_BOT_ID` pin, and
upstream-failure handling that never leaks the token.
