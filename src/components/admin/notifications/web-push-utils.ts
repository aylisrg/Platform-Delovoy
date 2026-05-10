/**
 * Web Push client-side helpers.
 *
 * Логика выделена из `WebPushOptIn.tsx` — компонент сам только орчестрирует
 * UI-состояния, а сетевые/криптографические операции тестируются здесь
 * через моки `fetch`/`PushManager` (без jsdom).
 *
 * См. ADR §UI компонент.
 */

export type SupportState =
  | "supported"
  | "ios_not_pwa" // Safari iOS — Push API доступен только в режиме «Add to Home Screen»
  | "unsupported"; // нет navigator.serviceWorker или PushManager в принципе

export type PermissionState = "default" | "granted" | "denied" | "unsupported";

/**
 * Определяет, поддерживает ли текущая среда Web Push.
 *
 * iOS Safari 16.4+ предоставляет PushManager только когда сайт запущен из
 * домашнего экрана (PWA-режим). Detection: `navigator.standalone === true`
 * или `display-mode: standalone`. См. PRD AC-5.6.
 */
export function detectSupport(nav: Navigator | undefined, win: Window | undefined): SupportState {
  if (typeof nav === "undefined" || typeof win === "undefined") return "unsupported";
  if (!("serviceWorker" in nav) || !("PushManager" in win)) {
    // На iOS Safari в обычном режиме (не PWA) PushManager отсутствует — это
    // нормальное состояние, сообщаем отдельно для лучшего UX.
    const ua = nav.userAgent || "";
    const isIOS = /iP(hone|ad|od)/.test(ua);
    // navigator.standalone — нестандартное Safari-only свойство.
    const standalone =
      "standalone" in nav && (nav as Navigator & { standalone?: boolean }).standalone === true;
    if (isIOS && !standalone) return "ios_not_pwa";
    return "unsupported";
  }
  return "supported";
}

/**
 * Конвертация base64url → Uint8Array для applicationServerKey.
 * Дублирует helper из sw.js, но нужен и в основном бандле.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}

/**
 * ArrayBuffer → base64url. Используется при сериализации `getKey('p256dh')`/`auth`
 * для отправки на сервер.
 */
export function arrayBufferToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type WebPushApi = {
  /** GET /api/notifications/web-push/vapid-public-key. Может бросить при 503. */
  getVapidPublicKey: () => Promise<string>;
  /** POST /api/notifications/web-push/subscribe */
  postSubscribe: (payload: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent?: string;
  }) => Promise<void>;
  /** DELETE /api/notifications/web-push/subscribe */
  deleteSubscribe: (endpoint: string) => Promise<void>;
};

/**
 * Production-реализация WebPushApi через `fetch`.
 * В тестах подставляется мок.
 */
export const defaultWebPushApi: WebPushApi = {
  async getVapidPublicKey() {
    const res = await fetch("/api/notifications/web-push/vapid-public-key", {
      credentials: "include",
    });
    if (!res.ok) {
      // 503 = WEB_PUSH_DISABLED — компонент должен скрыть UI.
      throw new Error(`vapid-key:${res.status}`);
    }
    const json = (await res.json()) as { data?: { publicKey?: string } };
    const key = json?.data?.publicKey;
    if (!key) throw new Error("vapid-key:no-key");
    return key;
  },
  async postSubscribe(payload) {
    const res = await fetch("/api/notifications/web-push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`subscribe:${res.status}`);
  },
  async deleteSubscribe(endpoint) {
    const res = await fetch("/api/notifications/web-push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ endpoint }),
    });
    if (!res.ok) throw new Error(`unsubscribe:${res.status}`);
  },
};

/**
 * Полный flow подписки: SW.register → permission → subscribe → POST.
 * Принимает API/registration/permissionFn инъекциями для тестов.
 */
export async function performSubscribe(deps: {
  api: WebPushApi;
  serviceWorker: ServiceWorkerContainer;
  pushManagerSubscribe: (
    registration: ServiceWorkerRegistration,
    options: PushSubscriptionOptionsInit,
  ) => Promise<PushSubscription>;
  requestPermission: () => Promise<NotificationPermission>;
  userAgent?: string;
}): Promise<{ endpoint: string }> {
  const permission = await deps.requestPermission();
  if (permission !== "granted") {
    throw new Error(`permission:${permission}`);
  }

  // Регистрация SW (idempotent — браузер вернёт существующую если уже).
  // scope: "/admin" — принцип минимальных привилегий (ADR §Безопасность).
  // SW не контролирует B2C-страницы.
  const registration = await deps.serviceWorker.register("/sw.js", { scope: "/admin" });

  // Получение VAPID ключа.
  const publicKey = await deps.api.getVapidPublicKey();

  // Подписка через PushManager.
  // applicationServerKey принимает BufferSource — копируем в свежий ArrayBuffer
  // (Uint8Array<ArrayBufferLike> в TS lib.dom не assignable напрямую).
  const keyBytes = urlBase64ToUint8Array(publicKey);
  const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyBuffer).set(keyBytes);
  const sub = await deps.pushManagerSubscribe(registration, {
    userVisibleOnly: true,
    applicationServerKey: keyBuffer,
  });

  const p256dh = arrayBufferToBase64Url(sub.getKey("p256dh"));
  const authKey = arrayBufferToBase64Url(sub.getKey("auth"));

  await deps.api.postSubscribe({
    endpoint: sub.endpoint,
    keys: { p256dh, auth: authKey },
    userAgent: deps.userAgent,
  });

  return { endpoint: sub.endpoint };
}

/**
 * Flow отписки: pushManager.getSubscription → unsubscribe → DELETE.
 */
export async function performUnsubscribe(deps: {
  api: WebPushApi;
  serviceWorker: ServiceWorkerContainer;
}): Promise<{ alreadyUnsubscribed: boolean }> {
  const registration = await deps.serviceWorker.getRegistration("/sw.js");
  if (!registration) return { alreadyUnsubscribed: true };
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return { alreadyUnsubscribed: true };
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await deps.api.deleteSubscribe(endpoint);
  return { alreadyUnsubscribed: false };
}
