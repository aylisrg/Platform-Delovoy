import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { apiError } from "./api-response";

/**
 * Единая проверка доступа к cron-эндпоинтам.
 *
 * - Только заголовок `Authorization: Bearer <CRON_SECRET>`. Query `?token=`
 *   не принимается: URL оседает в access-логах nginx и cron.
 * - CRON_SECRET обязателен. Фолбэка на NEXTAUTH_SECRET / AUTH_SECRET нет:
 *   секрет сессий не должен служить ключом cron.
 * - Сравнение за постоянное время.
 *
 * Возвращает `null`, если доступ разрешён, иначе готовый ответ с ошибкой.
 */
export function verifyCronRequest(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  if (!cronSecret) {
    return apiError("SERVICE_UNAVAILABLE", "CRON_SECRET is not configured", 503);
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const token = match ? match[1].trim() : "";
  if (!token || !safeCompare(token, cronSecret)) {
    return apiError("UNAUTHORIZED", "Invalid cron token", 401);
  }
  return null;
}

export function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  const len = Math.max(aBuf.length, bBuf.length, 32);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  return timingSafeEqual(aPad, bPad) && aBuf.length === bBuf.length;
}
