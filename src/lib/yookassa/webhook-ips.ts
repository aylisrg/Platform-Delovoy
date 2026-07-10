/**
 * Официальные IP-диапазоны, с которых ЮKassa шлёт HTTP-уведомления:
 * https://yookassa.ru/developers/using-api/webhooks#ip
 *
 * Проверка — ВТОРАЯ линия защиты (log-only): первая — секретный сегмент URL,
 * а решающая — re-fetch платежа по API (телу вебхука не доверяем вообще).
 * Блокировать по IP за прокси ненадёжно (X-Forwarded-For подделывается,
 * цепочки прокси различаются), поэтому несовпадение только логируется.
 */

const IPV4_RANGES: Array<[number, number]> = [
  // [network, maskBits] → [network int, mask int]
  cidrToRange("185.71.76.0/27"),
  cidrToRange("185.71.77.0/27"),
  cidrToRange("77.75.153.0/25"),
  cidrToRange("77.75.154.128/25"),
  cidrToRange("77.75.156.11/32"),
  cidrToRange("77.75.156.35/32"),
];

const IPV6_PREFIX = "2a02:5180:";

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = result * 256 + octet;
  }
  return result;
}

function cidrToRange(cidr: string): [number, number] {
  const [ip, bitsStr] = cidr.split("/");
  const network = ipv4ToInt(ip) ?? 0;
  const bits = Number(bitsStr);
  // Маска через деление (без побитовых операций — 32-битный сдвиг в JS ломается на /0)
  const size = 2 ** (32 - bits);
  const base = Math.floor(network / size) * size;
  return [base, base + size - 1];
}

export function isYooKassaIp(ip: string): boolean {
  const normalized = ip.trim();
  if (normalized.includes(":")) {
    return normalized.toLowerCase().startsWith(IPV6_PREFIX);
  }
  const value = ipv4ToInt(normalized);
  if (value === null) return false;
  return IPV4_RANGES.some(([from, to]) => value >= from && value <= to);
}

/** Первый адрес из X-Forwarded-For (ближайший к клиенту) либо null. */
export function extractClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip");
}
