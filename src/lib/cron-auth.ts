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
  /**
   * ПЕРЕХОДНЫЙ РЕЖИМ (#1084): дополнительно принимать NEXTAUTH_SECRET как Bearer.
   * Только для avito-* и inventory. Удалить через неделю (см. issue в PR #1084).
   */
  allowLegacyNextAuthSecret?: boolean;
  /** Имя маршрута для предупреждения в логе. */
  route?: string;
}

/**
 * Единая проверка cron-запроса (#1074).
 * Основной секрет: `process.env.CRON_SECRET`.
 * - токен совпал с CRON_SECRET -> null (ok)
 * - allowLegacyNextAuthSecret и токен совпал с NEXTAUTH_SECRET -> null + warn (без значения)
 * - CRON_SECRET не задан и легаси-путь не сработал -> 503
 * - иначе 401
 */
export function verifyCronRequest(
  request: NextRequest,
  options: VerifyCronOptions = {}
): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const token = getCronBearerToken(request);

  if (cronSecret && token && safeCompare(token, cronSecret)) return null;

  if (options.allowLegacyNextAuthSecret && token) {
    const legacy = process.env.NEXTAUTH_SECRET ?? "";
    if (legacy && safeCompare(token, legacy)) {
      console.warn(
        `[cron-auth] ${options.route ?? "cron"}: принят устаревший NEXTAUTH_SECRET, переведите вызов на CRON_SECRET (#1084)`
      );
      return null;
    }
  }

  const route = options.route ?? "cron";
  if (!cronSecret) {
    console.info(`[cron-auth] denied route=${route} status=503 reason=no_cron_secret`);
    return apiError("SERVICE_UNAVAILABLE", "CRON_SECRET is not configured", 503);
  }
  console.info(`[cron-auth] denied route=${route} status=401 reason=${token ? "bad_token" : "no_token"}`);
  return apiError("UNAUTHORIZED", "Invalid cron token", 401);
}

/** Переходный режим #1084: только для avito-* и inventory. */
export function verifyLegacyCronRequest(request: NextRequest, route: string): NextResponse | null {
  return verifyCronRequest(request, { allowLegacyNextAuthSecret: true, route });
}
