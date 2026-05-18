/* Service Worker для админки Делового Парка.
 * Назначение: Web Push (PRD US-5, ADR §Service Worker и PWA).
 *
 * НЕ кеширует ассеты и не предоставляет офлайн — это админка, не B2C-витрина.
 * См. ADR §«SW: next-pwa vs ручной public/sw.js» — выбран ручной минимальный вариант.
 *
 * При обновлении бамп SW_VERSION → браузер увидит изменение байтов и активирует
 * новую версию. clients.claim() в activate — чтобы новая версия немедленно
 * брала контроль над уже открытыми вкладками админки.
 */

const SW_VERSION = "1.1.0";

const WEBAPP_SHELL_CACHE = "webapp-shell-v1";
const WEBAPP_SHELL_URLS = [
  "/webapp",
  "/webapp/messenger",
  "/webapp/offline",
  "/icons/webapp-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      self.skipWaiting(),
      // Pre-cache webapp shell. Fail gracefully if any resource isn't found yet.
      caches.open(WEBAPP_SHELL_CACHE).then((cache) =>
        cache.addAll(WEBAPP_SHELL_URLS).catch(() => {
          // Shell resources may not exist yet in dev — skip silently.
        }),
      ),
    ]),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Push event — рендер уведомления.
 * Payload: { title, body, url, tag, icon } (см. ADR §API-контракты payload).
 *
 * Если payload не парсится как JSON — показываем дефолтное уведомление вместо
 * молчаливого падения (Chrome иначе покажет «This site has been updated in
 * the background», что бесполезно для менеджера).
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_err) {
    data = {};
  }

  const title = data.title || "Деловой — уведомление";
  const body = data.body || "Открыть админку для деталей";
  const url = data.url || "/admin/dashboard";
  const tag = data.tag || undefined;
  const icon = data.icon || "/icons/admin-192.png";

  const options = {
    body,
    tag,
    icon,
    badge: "/icons/admin-192.png",
    data: { url },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Notification click — фокус существующего окна админки или открытие нового.
 *
 * Стратегия: если есть открытое окно админки (любая страница /admin/*),
 * фокусируем его и навигируем на нужный URL. Иначе открываем новое.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Defence-in-depth: даже если push payload (контролируемый сервером) был
  // подделан через утечку VAPID-ключа — открываем только same-origin URL.
  const rawUrl = (event.notification.data && event.notification.data.url) || "/admin/dashboard";
  const targetUrl = (() => {
    try {
      const u = new URL(rawUrl, self.location.origin);
      return u.origin === self.location.origin ? u.href : "/admin/dashboard";
    } catch {
      return "/admin/dashboard";
    }
  })();

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        // Prefer a window that's already open at the target path.
        // Support both /admin/* and /webapp/* origins.
        const isAdminUrl = targetUrl.includes("/admin");
        const isWebappUrl = targetUrl.includes("/webapp");

        for (const client of windowClients) {
          const matchAdmin = isAdminUrl && client.url.includes("/admin");
          const matchWebapp = isWebappUrl && client.url.includes("/webapp");
          const matchAny = !isAdminUrl && !isWebappUrl;

          if ((matchAdmin || matchWebapp || matchAny) && "focus" in client) {
            if ("navigate" in client) {
              return client.navigate(targetUrl).then((c) => (c ? c.focus() : null));
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return null;
      }),
  );
});

/**
 * pushsubscriptionchange — браузер принудительно ротировал подписку
 * (например, истекла). Нужно: получить новую subscription и переотправить
 * на сервер; старую отписать.
 *
 * VAPID public key получаем через GET /api/notifications/web-push/vapid-public-key —
 * это публичный endpoint без auth.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        // Получаем VAPID public key.
        const keyRes = await fetch("/api/notifications/web-push/vapid-public-key");
        if (!keyRes.ok) return;
        const keyJson = await keyRes.json();
        const publicKey = keyJson && keyJson.data && keyJson.data.publicKey;
        if (!publicKey) return;

        // Подписываемся заново.
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

        // Регистрируем новую подписку.
        await fetch("/api/notifications/web-push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            endpoint: newSub.endpoint,
            keys: {
              p256dh: arrayBufferToBase64Url(newSub.getKey("p256dh")),
              auth: arrayBufferToBase64Url(newSub.getKey("auth")),
            },
          }),
        });

        // Деактивируем старую подписку (если событие принесло oldSubscription).
        const oldEndpoint = event.oldSubscription && event.oldSubscription.endpoint;
        if (oldEndpoint) {
          await fetch("/api/notifications/web-push/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ endpoint: oldEndpoint }),
          });
        }
      } catch (err) {
        // Тихо логируем — re-subscription будет предложена через UI при
        // следующем визите пользователя.
        console.warn("[sw] pushsubscriptionchange failed:", err);
      }
    })(),
  );
});

/**
 * Fetch handler — offline shell strategy for /webapp/*.
 *
 * Strategy by path:
 *   /webapp/* navigation → network-first, fallback /webapp/offline
 *   /_next/static/*      → cache-first (immutable hashed assets)
 *   /api/*               → network-only (never cache auth/data)
 *   /admin/*             → network-only (admin is not a PWA)
 *   everything else      → network
 */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // external — passthrough

  const { pathname } = url;

  // Static Next.js assets — cache first (they're content-hashed).
  if (pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(WEBAPP_SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Webapp navigation — network-first with offline fallback.
  if (pathname.startsWith("/webapp") && event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(WEBAPP_SHELL_CACHE);
        return (
          (await cache.match("/webapp/offline")) ||
          new Response("Offline", { status: 503 })
        );
      }),
    );
    return;
  }

  // API and admin — always network.
});

/**
 * Background Sync — flush IndexedDB outbox when connectivity is restored.
 * Registered on send failure: `swReg.sync.register('chat-sync')`.
 */
self.addEventListener("sync", (event) => {
  if (event.tag === "chat-sync") {
    event.waitUntil(
      (async () => {
        try {
          // POST to a flush endpoint — the webapp client must expose this.
          // The actual IndexedDB flush runs in the webapp page on receipt.
          const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
          for (const client of clients) {
            if (client.url.includes("/webapp")) {
              client.postMessage({ type: "chat-sync-flush" });
              break;
            }
          }
        } catch {
          // Will retry on next sync opportunity.
        }
      })(),
    );
  }
});

// --- helpers (используются только внутри SW) ---

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}

function arrayBufferToBase64Url(buf) {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Версия — чтобы при `view-source:/sw.js` было ясно, какая версия активна.
self.SW_VERSION = SW_VERSION;
