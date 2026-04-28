/**
 * POST /api/auth/telegram/start
 *
 * Mints a deep-link login token. Public endpoint, IP-rate-limited.
 *
 * Response:
 *   { token, deepLink, expiresAt, pollIntervalMs }
 *
 * Errors:
 *   429 RATE_LIMITED              — IP exceeded 5/min
 *   503 TELEGRAM_BOT_NOT_CONFIGURED — env vars missing
 */
import type { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/api-response";
import { hashIp, logAuthEvent } from "@/lib/audit";
import {
  checkStartRateLimit,
  createPendingToken,
} from "@/modules/auth/telegram-deep-link";

const POLL_INTERVAL_MS = 2000;

export async function POST(request: NextRequest) {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (!botUsername || !process.env.TELEGRAM_BOT_TOKEN) {
    return apiError(
      "TELEGRAM_BOT_NOT_CONFIGURED",
      "Вход через Telegram временно недоступен",
      503
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipHash = hashIp(ip);

  const rl = await checkStartRateLimit(ipHash);
  if (!rl.allowed) {
    return apiError(
      "RATE_LIMITED",
      `Слишком много запросов. Попробуйте через ${rl.retryAfterSec}с.`,
      429
    );
  }

  const { token, expiresAt } = await createPendingToken({ ipHash });

  // Anonymous attempt — no userId yet, so logAuthEvent will skip DB write
  // and emit a console line. Once the bot confirms, the success log will
  // carry the resolved userId.
  await logAuthEvent("auth.signin.attempt", null, {
    provider: "telegram-token",
    method: "deeplink",
    ipHash,
  });

  return apiResponse({
    token,
    deepLink: `https://t.me/${botUsername}?start=auth_${token}`,
    expiresAt,
    pollIntervalMs: POLL_INTERVAL_MS,
  });
}
