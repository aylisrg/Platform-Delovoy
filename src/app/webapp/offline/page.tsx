"use client";

import type * as React from "react";

/**
 * Offline fallback page. Раздаётся Service Worker'ом при отсутствии связи
 * (см. `public/sw.js`, `caches.match('/webapp/offline')`).
 *
 * Без auth-проверки: страница доступна всегда, чтобы быть закешированной
 * на этапе install SW и доступной без сети.
 */

export default function OfflinePage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="w-20 h-20 text-muted-foreground opacity-40"
      >
        <path d="M1 1l22 22" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <path d="M12 20h.01" />
      </svg>
      <h1 className="text-2xl font-semibold">Нет подключения</h1>
      <p className="text-muted-foreground max-w-xs">
        Проверьте интернет-соединение. Сообщения из черновика отправятся
        автоматически при восстановлении связи.
      </p>
      <button
        type="button"
        onClick={() => {
          if (typeof window !== "undefined") window.location.reload();
        }}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
      >
        Попробовать снова
      </button>
    </div>
  );
}
