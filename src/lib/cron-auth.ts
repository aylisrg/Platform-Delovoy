import { timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";

/**
 * Достаёт секрет cron-запроса только из заголовка `Authorization: Bearer <CRON_SECRET>`.
 * Query-параметр `?token=` больше не принимается (#1074): секрет в URL
 * попадает в access-логи и историю.
 */
export function getCronBearerToken(request: NextRequest): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

/**
 * Сравнение строк за постоянное время (crypto.timingSafeEqual).
 * При разной длине сравниваем буфер сам с собой, чтобы не выдавать длину по времени.
 */
export function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(bBuf, bBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export interface VerifyCronOptions {
  /** Имя маршрута для лога отказа. */
  route?: string;
}

/**
 * Единая проверка cron-запроса (#1074).
 * Основной секрет: `process.env.CRON_SECRET`.
 * NEXTAUTH_SECRET не принимается ни одним маршрутом (переходный режим #1084 снят в #1093).
 * - токен совпал с CRON_SECRET -> null (ok)
 * - CRON_SECRET не задан -> 503
 * - иначе 401
 */
export function verifyCronRequest(
  request: NextRequest,
  options: VerifyCronOptions = {}
): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const token = getCronBearerToken(request);

  if (cronSecret && token && safeCompare(token, cronSecret)) return null;

  const route = options.route ?? "cron";
  if (!cronSecret) {
    console.info(`[cron-auth] denied route=${route} status=503 reason=no_cron_secret`);
    return apiError("SERVICE_UNAVAILABLE", "CRON_SECRET is not configured", 503);
  }
  console.info(`[cron-auth] denied route=${route} status=401 reason=${token ? "bad_token" : "no_token"}`);
  return apiError("UNAUTHORIZED", "Invalid cron token", 401);
}
