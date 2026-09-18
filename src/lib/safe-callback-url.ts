/**
 * Нормализация `callbackUrl` — «куда вернуть пользователя после логина».
 *
 * Значение приходит из query-строки, то есть полностью подконтрольно тому, кто
 * прислал ссылку. Наивная проверка `raw.startsWith("/")` защиту НЕ даёт:
 * `//evil.com` и `/\evil.com` начинаются со слэша, но браузер трактует их как
 * protocol-relative URL и уводит пользователя на чужой домен прямо с нашего —
 * классический open redirect, который используют в фишинге («ссылка-то была
 * на delovoy-park.ru»).
 *
 * Поэтому здесь ровно два разрешённых случая:
 *   1. путь того же приложения — `/for-team`, `/admin/cafe?tab=1`;
 *   2. абсолютный URL нашего же origin — его присылает auth-гейт в proxy.ts
 *      (`signInUrl.searchParams.set("callbackUrl", request.nextUrl.href)`),
 *      он схлопывается до пути.
 * Всё остальное → `null`, и вызывающий код уходит на свой дефолт.
 */
export function safeCallbackUrl(
  raw: string | null | undefined,
  origin?: string | null,
): string | null {
  if (!raw) return null;

  let candidate = raw;

  // Абсолютный URL: принимаем только свой origin и схлопываем до пути.
  // Схлопнутый путь НЕ возвращаем сразу — он обязан пройти ровно те же
  // проверки, что и путь, пришедший напрямую. Иначе
  // `https://<наш-домен>//evil.com` проходит сверку origin, а `pathname`
  // у него — `//evil.com`, то есть снова protocol-relative: ссылка выглядит
  // целиком нашей, а уводит на чужой домен. Тот же обход даёт backslash
  // (`/\evil.com`) — `new URL()` нормализует его в `//`.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (!origin) return null;
    try {
      const url = new URL(raw);
      if (url.origin !== new URL(origin).origin) return null;
      candidate = url.pathname + url.search + url.hash;
    } catch {
      return null;
    }
  }

  if (!candidate.startsWith("/")) return null;

  // `//host` и `/\host` — protocol-relative, уводят на чужой домен.
  // Второй символ проверяем и на backslash: браузеры нормализуют `\` в `/`.
  if (candidate.length > 1 && (candidate[1] === "/" || candidate[1] === "\\")) {
    return null;
  }

  // Табы и переводы строк браузер из URL вырезает, то есть `/\t/evil.com`
  // после нормализации снова становится protocol-relative. Проще отсечь все
  // управляющие символы, чем гадать, что именно вырежет конкретный движок.
  if (/[\x00-\x1f\x7f]/.test(candidate)) return null;

  return candidate;
}
