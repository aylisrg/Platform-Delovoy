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

/**
 * Единая проверка cron-запроса (#1074).
 * Принимается только `process.env.CRON_SECRET` (без фолбэка на NEXTAUTH_SECRET).
 * - CRON_SECRET не задан -> 503
 * - токен отсутствует или не совпадает -> 401
 * - иначе null (запрос авторизован)
 */
export function verifyCronRequest(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET ?? "";
  if (!cronSecret) {
    return apiError("SERVICE_UNAVAILABLE", "CRON_SECRET is not configured", 503);
  }
  const token = getCronBearerToken(request);
  if (!token || !safeCompare(token, cronSecret)) {
    return apiError("UNAUTHORIZED", "Invalid cron token", 401);
  }
  return null;
}
