/**
 * Waits for the Telegram WebApp SDK to attach to `window`.
 *
 * The SDK is injected via a `<Script>` tag in the webapp layout. Because that
 * layout is nested (not the root layout), Next.js cannot fully guarantee the
 * `beforeInteractive` ordering, so the script can lose the race against React
 * mount — most visibly in iOS Safari / Telegram's in-app WebView, where script
 * scheduling differs from Chromium. When that happens `window.Telegram.WebApp`
 * is still `undefined` when the provider's bootstrap effect runs.
 *
 * Previously the bootstrap effect bailed permanently in that case, leaving the
 * UI stuck on its loading skeleton forever ("сайт не открывается" — бесконечный
 * спиннер). This helper instead polls for the SDK and, if it never appears
 * (e.g. the page was opened in plain Safari outside Telegram, or the script was
 * blocked), resolves with `null` after a bounded number of attempts so the UI
 * can degrade to guest mode instead of spinning forever.
 *
 * @param read       Accessor returning the WebApp object, or undefined if absent.
 * @param onResult   Called once with the WebApp, or `null` on timeout.
 * @param options    `intervalMs` (poll cadence) and `maxAttempts` (poll budget).
 * @returns A cancel function that stops polling and prevents `onResult`.
 */
export interface WaitForWebAppOptions {
  intervalMs?: number;
  maxAttempts?: number;
}

export function waitForWebApp<T>(
  read: () => T | undefined,
  onResult: (webapp: T | null) => void,
  { intervalMs = 100, maxAttempts = 30 }: WaitForWebAppOptions = {},
): () => void {
  // Fast path — SDK already present, resolve synchronously.
  const immediate = read();
  if (immediate) {
    onResult(immediate);
    return () => {};
  }

  let attempts = 0;
  const timer = setInterval(() => {
    const webapp = read();
    if (webapp) {
      clearInterval(timer);
      onResult(webapp);
      return;
    }
    attempts += 1;
    if (attempts >= maxAttempts) {
      clearInterval(timer);
      onResult(null);
    }
  }, intervalMs);

  return () => clearInterval(timer);
}
