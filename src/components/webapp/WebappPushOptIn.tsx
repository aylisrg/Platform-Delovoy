"use client";

/**
 * Webapp Push Opt-In.
 *
 * Аналог `/src/components/admin/notifications/WebPushOptIn.tsx`, но:
 *  - регистрирует SW со scope `/webapp`
 *  - не имеет RBAC-guard (USER — целевая аудитория)
 *  - упрощённый UI без «отключить» (на webapp убрать можно через настройки браузера)
 *
 * Используется на странице `/webapp/settings` и в баннере чатов.
 */

import type * as React from "react";
import { useCallback, useEffect, useState } from "react";
import {
  arrayBufferToBase64Url,
  detectSupport,
  urlBase64ToUint8Array,
  type SupportState,
} from "@/components/admin/notifications/web-push-utils";

type UiState =
  | { kind: "loading" }
  | { kind: "unsupported"; reason: SupportState }
  | { kind: "default" }
  | { kind: "denied" }
  | { kind: "subscribing" }
  | { kind: "subscribed" }
  | { kind: "error"; message: string };

type VapidResponse =
  | { success?: true; data?: { publicKey?: string } }
  | { success?: false; error?: { code?: string; message?: string } };

async function getVapidPublicKey(): Promise<string> {
  const res = await fetch("/api/notifications/web-push/vapid-public-key", {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`vapid-key:${res.status}`);
  const json = (await res.json()) as VapidResponse;
  const key = json && "data" in json ? json.data?.publicKey : undefined;
  if (!key) throw new Error("vapid-key:no-key");
  return key;
}

async function postSubscribe(payload: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}): Promise<void> {
  const res = await fetch("/api/notifications/web-push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`subscribe:${res.status}`);
}

export function WebappPushOptIn(): React.JSX.Element | null {
  const [state, setState] = useState<UiState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function init(): Promise<void> {
      const support = detectSupport(
        typeof navigator !== "undefined" ? navigator : undefined,
        typeof window !== "undefined" ? window : undefined,
      );
      if (support !== "supported") {
        if (!cancelled) setState({ kind: "unsupported", reason: support });
        return;
      }
      const permission = Notification.permission;
      if (permission === "denied") {
        if (!cancelled) setState({ kind: "denied" });
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const existing = reg ? await reg.pushManager.getSubscription() : null;
        if (existing && permission === "granted") {
          if (!cancelled) setState({ kind: "subscribed" });
          return;
        }
      } catch {
        // fallthrough
      }
      if (!cancelled) setState({ kind: "default" });
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubscribe = useCallback(async (): Promise<void> => {
    setState({ kind: "subscribing" });
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? { kind: "denied" } : { kind: "default" });
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/webapp",
      });
      const publicKey = await getVapidPublicKey();
      const keyBytes = urlBase64ToUint8Array(publicKey);
      const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
      new Uint8Array(keyBuffer).set(keyBytes);
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBuffer,
      });
      const p256dh = arrayBufferToBase64Url(sub.getKey("p256dh"));
      const authKey = arrayBufferToBase64Url(sub.getKey("auth"));
      await postSubscribe({
        endpoint: sub.endpoint,
        keys: { p256dh, auth: authKey },
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      });
      setState({ kind: "subscribed" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Неизвестная ошибка";
      setState({ kind: "error", message });
    }
  }, []);

  if (state.kind === "loading") return null;
  if (state.kind === "unsupported") {
    if (state.reason === "ios_not_pwa") {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Чтобы получать уведомления на iPhone, добавьте приложение на главный
          экран: «Поделиться» → «На экран Домой».
        </div>
      );
    }
    return null;
  }
  if (state.kind === "denied") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Уведомления заблокированы в настройках браузера. Разрешите их для этого
        сайта и перезагрузите страницу.
      </div>
    );
  }
  if (state.kind === "subscribed") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">
        Уведомления включены ✓
      </div>
    );
  }
  if (state.kind === "subscribing") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-500">
        Подписываем…
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
        <p className="text-red-900">Не удалось включить уведомления.</p>
        <button
          type="button"
          onClick={handleSubscribe}
          className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100"
        >
          Повторить
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={handleSubscribe}
      className="w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800"
    >
      Включить уведомления
    </button>
  );
}
