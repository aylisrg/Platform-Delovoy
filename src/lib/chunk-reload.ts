/**
 * Самолечение «стейл-вкладок»: после деплоя открытая вкладка со старым бандлом
 * ловит 404 на content-hashed чанки (`ChunkLoadError`) или
 * `Failed to find Server Action` — до ручной перезагрузки страница выглядит
 * «вечно грузящейся». Инцидент 2026-07-20, docs/incidents/.
 *
 * Чистая логика вынесена сюда для юнит-тестов; браузерная обвязка —
 * в `src/components/ChunkReloadGuard.tsx`.
 */

export const RELOAD_GUARD_KEY = "dp:chunk-reload-at";

/** Минимальный интервал между авто-перезагрузками одной вкладки. */
export const RELOAD_COOLDOWN_MS = 60_000;

const STALE_BUNDLE_PATTERNS = [
  /ChunkLoadError/i,
  /Loading chunk [\w-]+ failed/i,
  /Loading CSS chunk/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Failed to find Server Action/i,
];

/** Похожа ли ошибка на «бандл вкладки устарел после деплоя». */
export function isStaleBundleError(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  return STALE_BUNDLE_PATTERNS.some((re) => re.test(message));
}

type GuardStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Однократная перезагрузка с кулдауном: true максимум раз в
 * RELOAD_COOLDOWN_MS на вкладку (guard в sessionStorage) — чтобы битая
 * страница не ушла в цикл перезагрузок.
 * Недоступный storage (приватный режим Safari) = не перезагружаем: без guard
 * цикл не исключён, безопаснее оставить вкладку как есть.
 */
export function shouldReload(storage: GuardStorage, now: number): boolean {
  try {
    const last = Number(storage.getItem(RELOAD_GUARD_KEY) ?? 0);
    if (Number.isFinite(last) && now - last < RELOAD_COOLDOWN_MS) return false;
    storage.setItem(RELOAD_GUARD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
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
