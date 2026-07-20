"use client";

import { useEffect } from "react";
import {
  extractErrorMessage,
  isStaleBundleError,
  shouldReload,
} from "@/lib/chunk-reload";

/**
 * Глобальный слушатель ошибок стейл-бандла (см. src/lib/chunk-reload.ts):
 * после деплоя вкладка со старым билдом сама перезагружается один раз вместо
 * «вечной загрузки». Рендерит null, монтируется в корневом layout.
 */
export function ChunkReloadGuard() {
  useEffect(() => {
    const handle = (event: ErrorEvent | PromiseRejectionEvent) => {
      if (!isStaleBundleError(extractErrorMessage(event))) return;
      if (shouldReload(window.sessionStorage, Date.now())) {
        window.location.reload();
      }
    };
    window.addEventListener("error", handle);
    window.addEventListener("unhandledrejection", handle);
    return () => {
      window.removeEventListener("error", handle);
      window.removeEventListener("unhandledrejection", handle);
    };
  }, []);

  return null;
}
