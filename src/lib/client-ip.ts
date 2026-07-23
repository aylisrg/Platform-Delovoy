import { NextRequest } from "next/server";

/**
 * Доверенный IP клиента за nginx.
 *
 * Приложение слушает только 127.0.0.1:3000 (docker-compose.prod.yml), значит
 * весь внешний трафик проходит через host-nginx, который ставит:
 *   X-Real-IP        = $remote_addr            — не подделывается клиентом;
 *   X-Forwarded-For  = $proxy_add_x_forwarded_for — ДОПИСЫВАЕТ $remote_addr
 *                      к клиентскому заголовку.
 *
 * Поэтому доверять всей XFF-цепочке нельзя: её начало контролирует клиент
 * (произвольная строка = обход rate-limit по ключу). Порядок доверия:
 * X-Real-IP → последний элемент XFF (его добавил nginx) → "unknown".
 */
export function getClientIp(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  return "unknown";
}
