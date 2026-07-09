/**
 * Transport layer for all server-side Telegram Bot API calls.
 *
 * Every call gets a hard timeout (default 15s) so a stalled connection to
 * api.telegram.org never hangs a request handler, and two env vars provide
 * escape hatches when the VPS cannot reach Telegram directly:
 *
 * - TELEGRAM_API_ROOT  — alternative Bot API root (relay / local Bot API
 *   server), e.g. https://tg-relay.example.com
 * - TELEGRAM_PROXY_URL — HTTP(S) CONNECT proxy for Telegram traffic only,
 *   e.g. http://user:pass@proxy-host:3128. SOCKS is not supported — use an
 *   API-root relay instead.
 *
 * Higher-level helpers (sendTelegramAlert, notification channels) stay as
 * they are and call telegramApi() underneath.
 */

import type { ProxyAgent } from "undici";

export const DEFAULT_TELEGRAM_API_ROOT = "https://api.telegram.org";

const DEFAULT_TIMEOUT_MS = 15_000;

export function getTelegramApiRoot(): string {
  const root = process.env.TELEGRAM_API_ROOT?.trim();
  if (!root) return DEFAULT_TELEGRAM_API_ROOT;
  return root.replace(/\/+$/, "");
}

export function getTelegramProxyUrl(): string | undefined {
  const url = process.env.TELEGRAM_PROXY_URL?.trim();
  return url || undefined;
}

export type TelegramApiOptions = {
  /** Defaults to process.env.TELEGRAM_BOT_TOKEN */
  botToken?: string;
  /** Hard cap for the whole HTTP call. Defaults to 15 000 ms. */
  timeoutMs?: number;
};

export type TelegramApiSuccess<T> = {
  ok: true;
  result: T;
  status?: number;
};

export type TelegramApiFailure = {
  ok: false;
  /** Telegram `description`, `HTTP <status>`, or a transport error message. */
  description: string;
  /** HTTP status; undefined when the request never got a response. */
  status?: number;
  /** Worth retrying later: network failure, 5xx or 429. */
  retryable: boolean;
  /** The request never reached Telegram (timeout / DNS / connection error). */
  transportError: boolean;
};

export type TelegramApiResult<T = unknown> = TelegramApiSuccess<T> | TelegramApiFailure;

/** Cached per proxy URL so repeated calls reuse one CONNECT pool. */
let cachedProxy: { url: string; agent: ProxyAgent } | null = null;

async function proxiedFetch(url: string, init: RequestInit): Promise<Response> {
  const proxyUrl = getTelegramProxyUrl();
  if (!proxyUrl) return fetch(url, init);

  const undici = await import("undici");
  if (!cachedProxy || cachedProxy.url !== proxyUrl) {
    cachedProxy = { url: proxyUrl, agent: new undici.ProxyAgent(proxyUrl) };
  }
  // undici's own fetch is used for the proxy path: Next patches global fetch
  // and is not guaranteed to forward the non-standard `dispatcher` init.
  const res = await undici.fetch(url, {
    ...(init as import("undici").RequestInit),
    dispatcher: cachedProxy.agent,
  });
  return res as unknown as Response;
}

function isRetryableStatus(status: number | undefined): boolean {
  return status !== undefined && (status >= 500 || status === 429);
}

/**
 * Call a Telegram Bot API method. Never throws.
 */
export async function telegramApi<T = unknown>(
  method: string,
  payload?: Record<string, unknown> | FormData,
  options: TelegramApiOptions = {}
): Promise<TelegramApiResult<T>> {
  const token = options.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return {
      ok: false,
      description: "TELEGRAM_BOT_TOKEN not set",
      retryable: false,
      transportError: false,
    };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${getTelegramApiRoot()}/bot${token}/${method}`;

  const init: RequestInit =
    payload instanceof FormData
      ? { method: "POST", body: payload, signal: AbortSignal.timeout(timeoutMs) }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload ?? {}),
          signal: AbortSignal.timeout(timeoutMs),
        };

  let res: Response;
  try {
    res = await proxiedFetch(url, init);
  } catch (err) {
    return { ok: false, description: describeTransportError(err, timeoutMs), retryable: true, transportError: true };
  }

  const status = typeof res.status === "number" ? res.status : undefined;

  let body: { ok?: boolean; description?: string; result?: T } | undefined;
  try {
    const parsed: unknown = typeof res.json === "function" ? await res.json() : undefined;
    if (parsed !== null && typeof parsed === "object") {
      body = parsed as { ok?: boolean; description?: string; result?: T };
    }
  } catch {
    body = undefined;
  }

  if (body) {
    if (body.ok === true) {
      return { ok: true, result: body.result as T, status };
    }
    return {
      ok: false,
      description: body.description ?? `HTTP ${status ?? "error"}`,
      status,
      retryable: isRetryableStatus(status),
      transportError: false,
    };
  }

  // Non-JSON response (misbehaving relay or bare mock): fall back to HTTP level.
  if (res.ok) {
    return { ok: true, result: undefined as T, status };
  }
  return {
    ok: false,
    description: `HTTP ${status ?? "error"}`,
    status,
    retryable: isRetryableStatus(status),
    transportError: false,
  };
}

function describeTransportError(err: unknown, timeoutMs: number): string {
  const e = err as { name?: string; message?: string; cause?: { message?: string; code?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") {
    return `Timeout after ${timeoutMs}ms connecting to ${getTelegramApiRoot()}`;
  }
  const cause = e?.cause?.code ?? e?.cause?.message;
  return cause ? `${e?.message ?? "fetch failed"} (${cause})` : (e?.message ?? "fetch failed");
}
