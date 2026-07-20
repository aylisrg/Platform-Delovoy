"use client";

import { useEffect } from "react";
import {
  buildClientErrorPayload,
  createReportLimiter,
  extractErrorMessage,
  type BeaconSource,
} from "@/lib/client-error-beacon";

/**
 * Глобальный error-beacon: необработанные ошибки браузера уходят в
 * POST /api/monitoring/client-error → SystemEvent (source "client-beacon").
 * Введён по инциденту 2026-07-20 — клиентские причины «вечной загрузки»
 * были невидимы серверному мониторингу. Рендерит null.
 */
export function ClientErrorBeacon() {
  useEffect(() => {
    const shouldReport = createReportLimiter();

    const send = (message: string, source: BeaconSource) => {
      if (!shouldReport(message)) return;
      const payload = buildClientErrorPayload(
        message,
        source,
        window.location.href,
        navigator.userAgent,
      );
      fetch("/api/monitoring/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        // Бикон никогда не должен порождать собственные ошибки.
      });
    };

    const onError = (event: ErrorEvent) => {
      send(extractErrorMessage(event), "window-error");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      send(extractErrorMessage(event), "unhandled-rejection");
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
