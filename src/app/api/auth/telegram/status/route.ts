/**
 * GET /api/auth/telegram/status?token=<token>
 *
 * Frontend polls this every 2s while the user completes the Telegram
 * deep-link flow. The state machine is owned by Redis (PENDING →
 * CONFIRMED → CONSUMED) — this endpoint translates it into a clean
 * frontend contract:
 *
 *   { status: "pending" }
 *   { status: "confirmed", oneTimeCode: "<JWT>" }   // 30s exp
 *   { status: "consumed" }                          // already redeemed
 *   { status: "expired" }                           // unknown / timed out
 *
 * The transition CONFIRMED → CONSUMED is best-effort atomic via the
 * service module; if the second poll arrives before our SET completes
 * it would also see CONFIRMED and mint a second JWT, but the
 * `telegram-token` Credentials provider dedups by jti, so only the
 * first signIn call wins.
 */
import type { NextRequest } from "next/server";
import { SignJWT } from "jose";
import crypto from "crypto";
import { apiResponse, apiError } from "@/lib/api-response";
import { hashIp } from "@/lib/audit";
import {
  ONE_TIME_CODE_TTL_SECONDS,
  checkStatusRateLimit,
  consumeConfirmedToken,
  readTokenEntry,
} from "@/modules/auth/telegram-deep-link";
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_TYPE,
} from "@/modules/auth/telegram-token-jwt";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token || typeof token !== "string" || token.length > 64) {
    return apiError("INVALID_TOKEN", "Некорректный токен", 400);
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ipHash = hashIp(ip);

  const rl = await checkStatusRateLimit(token, ipHash);
  if (!rl.allowed) {
    return apiError(
      "RATE_LIMITED",
      `Слишком частая проверка. Попробуйте через ${rl.retryAfterSec}с.`,
      429
    );
  }

  const entry = await readTokenEntry(token);
  if (!entry) {
    return apiResponse({ status: "expired" } as const);
  }

  if (entry.status === "PENDING") {
    return apiResponse({ status: "pending" } as const);
  }

  if (entry.status === "CONSUMED") {
    return apiResponse({ status: "consumed" } as const);
  }

  // CONFIRMED: try to consume + mint JWT.
  const consumed = await consumeConfirmedToken(token);
  if (!consumed) {
    // Race: another poll just consumed it.
    return apiResponse({ status: "consumed" } as const);
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    // Misconfigured — fail closed.
    return apiError(
      "AUTH_NOT_CONFIGURED",
      "Сервер не настроен для входа",
      503
    );
  }

  const jti = crypto.randomBytes(16).toString("hex");
  const oneTimeCode = await new SignJWT({
    sub: consumed.userId,
    type: JWT_TYPE,
    jti,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ONE_TIME_CODE_TTL_SECONDS}s`)
    .setJti(jti)
    .sign(new TextEncoder().encode(secret));

  return apiResponse({
    status: "confirmed" as const,
    oneTimeCode,
  });
}
