import type { NotificationChannelKind } from "@prisma/client";
import webPush from "web-push";
import { prisma } from "@/lib/db";
import type {
  DeliveryResult,
  INotificationChannel,
  NotificationPayload,
} from "../../types";
import {
  deactivateSubscriptionByEndpoint,
  recordSuccessfulDelivery,
} from "./service";
import { isWebPushEnabled, readVapidConfigFromEnv } from "./vapid";

type WebPushError = Error & {
  statusCode?: number;
  body?: string;
};

/**
 * Web Push канал — реализация INotificationChannel поверх библиотеки `web-push`.
 *
 * `address` — это endpoint URL подписки (то что хранится в UserNotificationChannel.address).
 * Криптоключи (p256dh, auth) живут в sidecar-таблице WebPushSubscription и подгружаются
 * по endpoint в момент отправки. Это сохраняет single-target контракт интерфейса
 * (см. ADR §«Multi-device fan-out», вариант B).
 *
 * Канал регистрируется в bootstrapChannels всегда, но isAvailable() возвращает true
 * только когда WEB_PUSH_ENABLED=true И заданы валидные VAPID-ключи. По умолчанию OFF.
 */
export class WebPushChannel implements INotificationChannel {
  readonly kind: NotificationChannelKind = "PUSH";

  private vapidConfigured = false;

  constructor(
    private readonly env: Partial<Record<string, string | undefined>> = process.env,
  ) {
    this.configureVapidLazy();
  }

  private configureVapidLazy(): void {
    if (this.vapidConfigured) return;
    const cfg = readVapidConfigFromEnv(this.env);
    if (!cfg) return;
    webPush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    this.vapidConfigured = true;
  }

  isAvailable(): boolean {
    return isWebPushEnabled(this.env);
  }

  async send(
    address: string,
    payload: NotificationPayload,
  ): Promise<DeliveryResult> {
    if (!this.isAvailable()) {
      return {
        ok: false,
        reason: "web push not enabled",
        retryable: false,
      };
    }
    this.configureVapidLazy();

    const sub = await prisma.webPushSubscription.findUnique({
      where: { endpoint: address },
      select: {
        endpoint: true,
        p256dh: true,
        auth: true,
        isActive: true,
      },
    });

    if (!sub || !sub.isActive) {
      return {
        ok: false,
        reason: "subscription not found or inactive",
        retryable: false,
      };
    }

    try {
      const body = JSON.stringify({
        title: payload.title,
        body: payload.body,
        actions: payload.actions ?? [],
        metadata: payload.metadata ?? {},
      });
      const result = await webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
        { TTL: 60, urgency: "high" },
      );
      await recordSuccessfulDelivery(sub.endpoint);
      const externalId =
        typeof result === "object" && result && "headers" in result
          ? extractMessageId(result as { headers?: Record<string, string> })
          : undefined;
      return { ok: true, externalId };
    } catch (err) {
      return this.classifyError(sub.endpoint, err);
    }
  }

  private async classifyError(
    endpoint: string,
    err: unknown,
  ): Promise<DeliveryResult> {
    const e = err as WebPushError;
    const status = e.statusCode;

    if (status === 404 || status === 410) {
      // Endpoint мёртв — отписываем на нашей стороне.
      await deactivateSubscriptionByEndpoint(endpoint, `HTTP ${status}`);
      return {
        ok: false,
        reason: `expired (HTTP ${status})`,
        retryable: false,
      };
    }

    if (status === 401 || status === 403) {
      // VAPID mismatch — вероятно, публичный ключ ротировался без переподписки.
      await deactivateSubscriptionByEndpoint(endpoint, `VAPID ${status}`);
      return {
        ok: false,
        reason: `auth ${status}`,
        retryable: false,
      };
    }

    if (status === 429 || (typeof status === "number" && status >= 500 && status < 600)) {
      return {
        ok: false,
        reason: `HTTP ${status}`,
        retryable: true,
      };
    }

    return {
      ok: false,
      reason: e.message ?? "unknown",
      retryable: false,
    };
  }
}

function extractMessageId(result: {
  headers?: Record<string, string>;
}): string | undefined {
  const h = result.headers ?? {};
  return h["location"] ?? h["Location"] ?? undefined;
}
