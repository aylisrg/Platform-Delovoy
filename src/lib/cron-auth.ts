import type { NextRequest } from "next/server";

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
