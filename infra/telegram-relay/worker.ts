/**
 * Telegram Bot API relay — Cloudflare Worker (serverless, free tier).
 *
 * WHY THIS EXISTS
 * ---------------
 * From the Timeweb VPS the egress path *specifically* to api.telegram.org is
 * dropped on ТСПУ (RU DPI) — the `Telegram Diagnose` workflow returns
 * FULL_BLOCK: DNS resolves, general egress is fine (api.github.com → 200,
 * ya.ru → 302), but every fresh connection to api.telegram.org times out
 * (HTTP 000 on both IPv4 and IPv6). The bot appears to work only because its
 * long-poll keeps one connection warm across the block's "waves"; every
 * notification opens a fresh connection and dies — hence the constant errors.
 *
 * This Worker gives the server a clean egress that is NOT on the blocked path:
 * the VPS makes an ordinary HTTPS request to Cloudflare (not Telegram-specific,
 * not blocked), and Cloudflare's edge — outside ТСПУ — forwards it to
 * api.telegram.org. No extra server, no extra IP, free tier.
 *
 * WIRE-UP (zero application code changes)
 * ---------------------------------------
 * Every server-side Bot API call already goes through TELEGRAM_API_ROOT
 * (src/lib/telegram/client.ts for `app`, grammy `apiRoot` for `bot`). Set:
 *   TELEGRAM_API_ROOT = https://<worker>.workers.dev/<RELAY_SECRET>
 * and both processes egress through here. The client builds
 *   `${TELEGRAM_API_ROOT}/bot<token>/<method>`
 * so this Worker receives `/<RELAY_SECRET>/bot<token>/<method>` and forwards
 * `https://api.telegram.org/bot<token>/<method>` verbatim (method, body,
 * query and content-type preserved).
 *
 * SECRETS / VARS (npx wrangler secret put … — never commit values)
 * ----------------------------------------------------------------
 *   RELAY_SECRET   (required) unguessable path prefix. Stops the Worker being
 *                  used as an open Telegram proxy for someone else's bot.
 *   ALLOWED_BOT_ID (optional) numeric id before ':' in your token. When set,
 *                  the Worker only ever forwards calls for that one bot —
 *                  defence-in-depth against quota abuse if the URL leaks.
 *
 * PORTABILITY: `handleRelay` is a plain (Request, env) → Response function, so
 * the same logic runs on Deno Deploy / Vercel Edge — only the export wrapper
 * differs. You are not locked into Cloudflare.
 */

export interface RelayEnv {
  RELAY_SECRET?: string;
  ALLOWED_BOT_ID?: string;
}

const UPSTREAM = "https://api.telegram.org";

/** Length-safe, constant-time string comparison (avoids leaking the secret). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Core handler. Kept runtime-agnostic so it can be unit-tested under Node/vitest
 * and re-exported for Deno Deploy / Vercel Edge unchanged.
 */
export async function handleRelay(request: Request, env: RelayEnv): Promise<Response> {
  const secret = env.RELAY_SECRET?.trim();
  if (!secret) return json(500, { ok: false, error_code: 500, description: "relay not configured" });

  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter((s) => s.length > 0);

  // 1) First path segment must equal the shared secret.
  const provided = segments.shift() ?? "";
  if (!timingSafeEqual(provided, secret)) {
    return json(404, { ok: false, error_code: 404, description: "not found" });
  }

  // 2) Remaining path must be a Bot API call — either `/bot<token>/<method>`
  //    or a file download `/file/bot<token>/<path>`.
  const botIndex = segments[0] === "file" ? 1 : 0;
  const botSegment = segments[botIndex] ?? "";
  if (!botSegment.startsWith("bot")) {
    return json(400, { ok: false, error_code: 400, description: "bad request" });
  }

  // 3) Optional hard pin to a single bot id (anti-abuse for the CF quota).
  if (env.ALLOWED_BOT_ID) {
    const match = /^bot(\d+):/.exec(botSegment);
    if (!match || match[1] !== String(env.ALLOWED_BOT_ID).trim()) {
      return json(403, { ok: false, error_code: 403, description: "forbidden" });
    }
  }

  const target = `${UPSTREAM}/${segments.join("/")}${url.search}`;

  // Forward method + body + content-type as-is. Host/hop headers are dropped so
  // the upstream sees a clean request; the bot token lives only in the path.
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit = {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  };

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    // Never echo `target` — it contains the bot token.
    return json(502, { ok: false, error_code: 502, description: "relay upstream unreachable" });
  }

  const respHeaders = new Headers();
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) respHeaders.set("content-type", upstreamType);
  // Preserve rate-limit backoff so the caller's retry logic stays correct.
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) respHeaders.set("retry-after", retryAfter);

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: respHeaders,
  });
}

export default { fetch: handleRelay };
