/**
 * Avito API low-level client: OAuth2 client_credentials + fetch with retry/backoff.
 * Token cached in Redis for ~23.5h (Avito tokens last 24h).
 */

import { redis, redisAvailable } from "@/lib/redis";
import {
  AVITO_API_URL,
  AVITO_AUTH_URL,
  AvitoApiError,
  TOKEN_CACHE_KEY,
} from "./types";

/** True if AVITO_CLIENT_ID + AVITO_CLIENT_SECRET are present in env. */
export function isAvitoCredentialsConfigured(): boolean {
  return Boolean(process.env.AVITO_CLIENT_ID && process.env.AVITO_CLIENT_SECRET);
}

/**
 * Legacy gate kept until env-based AVITO_ITEM_ID is fully retired.
 * New callers should use isAvitoCredentialsConfigured().
 */
export function isLegacyEnvConfigured(): boolean {
  return Boolean(
    process.env.AVITO_CLIENT_ID &&
      process.env.AVITO_CLIENT_SECRET &&
      process.env.AVITO_ITEM_ID
  );
}

export async function getAccessToken(): Promise<string | null> {
  if (!isAvitoCredentialsConfigured()) return null;

  if (redisAvailable) {
    try {
      const cached = await redis.get(TOKEN_CACHE_KEY);
      if (cached) return cached;
    } catch {
      // Redis miss is fine
    }
  }

  const res = await fetch(AVITO_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AVITO_CLIENT_ID!,
      client_secret: process.env.AVITO_CLIENT_SECRET!,
    }),
    next: { revalidate: 0 },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as { access_token: string; expires_in: number };

  if (redisAvailable) {
    try {
      await redis.setex(TOKEN_CACHE_KEY, Math.max(60, data.expires_in - 1800), data.access_token);
    } catch {
      // Cache failure is non-fatal
    }
  }

  return data.access_token;
}

type FetchOpts = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Max retries on 5xx/429. Default 3. */
  retries?: number;
};

/**
 * Authenticated fetch wrapper. Throws AvitoApiError on non-2xx.
 * Implements exponential backoff for 429/5xx (1s → 3s → 9s).
 */
export async function avitoFetch<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new AvitoApiError(401, "AVITO_NOT_CONFIGURED");

  const url = new URL(path, AVITO_API_URL);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  const maxRetries = opts.retries ?? 3;
  let lastErr: AvitoApiError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.min(9000, 1000 * Math.pow(3, attempt - 1));
      await new Promise((r) => setTimeout(r, delayMs));
    }

    const res = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      next: { revalidate: 0 },
    });

    if (res.ok) {
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }

    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {
      // ignore
    }
    lastErr = new AvitoApiError(res.status, `HTTP ${res.status}: ${bodyText.slice(0, 500)}`, bodyText);

    // Only retry on 429/5xx
    if (!lastErr.retryable) throw lastErr;
  }

  throw lastErr ?? new AvitoApiError(500, "AVITO_API_ERROR_UNKNOWN");
}
