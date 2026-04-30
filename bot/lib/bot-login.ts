/**
 * Helpers for the bot→web one-time login flow (ADR 2026-04-30).
 *
 * Bot calls the internal endpoint `POST /api/internal/auth/bot-login-token`
 * with a shared `BOT_INTERNAL_SECRET`. The endpoint mints a one-time token
 * for an already-linked `User.telegramId` and returns a callback URL that
 * we embed into the inline-keyboard "🌐 Открыть сайт" button.
 *
 * Failure modes (404 / 429 / 5xx / network / timeout / missing secret) all
 * collapse to `null` — the caller is expected to fall back to the plain
 * APP_URL so the welcome reply never blocks on an integration failure.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const ENDPOINT_PATH = "/api/internal/auth/bot-login-token";

/** Hard cap on how long /start may wait for the mint response. */
export const MINT_TIMEOUT_MS = 3000;

type MintResponseShape = {
  success?: boolean;
  data?: {
    callbackUrl?: string;
    token?: string;
    expiresAt?: string;
    expiresInSec?: number;
  };
  error?: { code?: string; message?: string };
};

/**
 * Mint a bot→web login URL for an already-linked Telegram user.
 *
 * Returns the callback URL on success, or `null` on:
 *   - missing `BOT_INTERNAL_SECRET` (graceful — feature simply disabled)
 *   - HTTP 4xx/5xx from the backend (404 USER_NOT_FOUND, 429, 503, etc.)
 *   - network error / abort / timeout
 *   - malformed response body
 *
 * Never throws.
 */
export async function mintBotLoginUrl(
  telegramId: string
): Promise<string | null> {
  const secret = process.env.BOT_INTERNAL_SECRET;
  if (!secret) {
    // Graceful degradation: feature simply disabled until ops sets it.
    return null;
  }

  const url = `${APP_URL.replace(/\/+$/, "")}${ENDPOINT_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MINT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ telegramId }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // 404 USER_NOT_FOUND is expected for not-yet-linked users; everything
      // else is worth a warning so ops sees rate-limit/secret/Redis issues.
      if (response.status !== 404) {
        console.warn(
          `[bot-login] mint non-OK status=${response.status} for telegramId=${maskTelegramId(telegramId)}`
        );
      }
      return null;
    }

    const json = (await response.json()) as MintResponseShape;
    const callbackUrl = json?.data?.callbackUrl;
    if (typeof callbackUrl !== "string" || callbackUrl.length === 0) {
      console.warn(
        "[bot-login] mint OK but callbackUrl missing in response payload"
      );
      return null;
    }

    return callbackUrl;
  } catch (err) {
    // AbortError on timeout, TypeError on network, anything else — collapse.
    const name = (err as { name?: string } | null)?.name ?? "Error";
    console.warn(
      `[bot-login] mint failed (${name}) for telegramId=${maskTelegramId(telegramId)}`
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mask a telegramId for log output (keep last 3 digits).
 */
function maskTelegramId(id: string): string {
  if (id.length <= 4) return "***";
  return `***${id.slice(-3)}`;
}
