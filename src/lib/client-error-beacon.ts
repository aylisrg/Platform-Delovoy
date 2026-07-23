/**
 * Чистая логика клиентского error-beacon (браузерная обвязка —
 * src/components/ClientErrorBeacon.tsx, приёмник —
 * POST /api/monitoring/client-error).
 *
 * Задача: доставить необработанные браузерные ошибки в SystemEvent, не
 * становясь при этом источником флуда — потолок отправок на страницу,
 * дедупликация повторов, отсев заведомого шума.
 */

export const MAX_REPORTS_PER_PAGE = 3;
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_META_LENGTH = 300;
export const MAX_CONNECTION_LENGTH = 30;

export type BeaconSource = "window-error" | "unhandled-rejection";

export type ClientErrorPayload = {
  message: string;
  source: BeaconSource;
  url?: string;
  userAgent?: string;
  /** Тип сети клиента ("wifi/4g", "cellular/3g", …) — см. describeConnection. */
  connection?: string;
};

/**
 * Тип сети из Network Information API (navigator.connection). Есть в
 * Chromium/Android — ровно та аудитория, где живёт симптом «с LTE не
 * работает»: даёт мониторингу разрез ошибок wifi vs 4g. В Safari/Firefox
 * API нет — вернётся undefined, поле просто не отправится.
 */
export function describeConnection(nav: unknown): string | undefined {
  const conn = (nav as { connection?: unknown } | null | undefined)?.connection;
  if (typeof conn !== "object" || conn === null) return undefined;
  const c = conn as { type?: unknown; effectiveType?: unknown };
  const parts = [c.type, c.effectiveType].filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  if (parts.length === 0) return undefined;
  return parts.join("/").slice(0, MAX_CONNECTION_LENGTH);
}

/**
 * Шум, который не стоит доставки: кросс-доменное «Script error.» (нулевая
 * информация), обрывы сети при уходе со страницы, отменённые запросы.
 */
const NOISE_PATTERNS = [
  /^Script error\.?$/i,
  /ResizeObserver loop/i,
  /AbortError/i,
  /Load failed$/i,
  /NetworkError when attempting to fetch resource/i,
];

export function isNoise(message: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(message.trim()));
}

/**
 * Лимитер отправок одной страницы: не больше max штук, повторы одного
 * message не шлём. Возвращает true, если ошибку стоит отправить.
 */
export function createReportLimiter(max: number = MAX_REPORTS_PER_PAGE) {
  const seen = new Set<string>();
  let sent = 0;
  return function shouldReport(message: string): boolean {
    if (!message || isNoise(message)) return false;
    if (sent >= max) return false;
    const key = message.slice(0, 200);
    if (seen.has(key)) return false;
    seen.add(key);
    sent++;
    return true;
  };
}

/** Достаёт message из ErrorEvent | PromiseRejectionEvent без завязки на DOM-типы. */
export function extractErrorMessage(event: unknown): string {
  if (typeof event !== "object" || event === null) return "";
  const e = event as { message?: unknown; reason?: unknown };
  if (typeof e.message === "string" && e.message) return e.message;
  const reason = e.reason;
  if (typeof reason === "string") return reason;
  if (typeof reason === "object" && reason !== null) {
    const r = reason as { message?: unknown; name?: unknown };
    const parts = [r.name, r.message].filter(
      (v): v is string => typeof v === "string",
    );
    return parts.join(": ");
  }
  return "";
}

/** Собирает полезную нагрузку с усечением до лимитов API. */
export function buildClientErrorPayload(
  message: string,
  source: BeaconSource,
  url?: string,
  userAgent?: string,
  connection?: string,
): ClientErrorPayload {
  return {
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    source,
    ...(url ? { url: url.slice(0, MAX_META_LENGTH) } : {}),
    ...(userAgent ? { userAgent: userAgent.slice(0, MAX_META_LENGTH) } : {}),
    ...(connection ? { connection: connection.slice(0, MAX_CONNECTION_LENGTH) } : {}),
  };
}
