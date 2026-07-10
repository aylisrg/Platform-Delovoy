import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { log } from "@/lib/logger";
import {
  yooWebhookNotificationSchema,
  HANDLED_WEBHOOK_EVENTS,
} from "@/lib/yookassa/types";
import { extractClientIp, isYooKassaIp } from "@/lib/yookassa/webhook-ips";
import {
  syncPaymentByProviderId,
  syncRefundByProviderId,
} from "@/modules/payments/service";

/**
 * POST /api/payments/yookassa/webhook/{secret} — HTTP-уведомления ЮKassa.
 *
 * Защита (план § 4.4):
 * 1. Секретный сегмент URL (YOOKASSA_WEBHOOK_SECRET), constant-time compare,
 *    fail-secure: без секрета в env — 503, как telephony/webhook.
 * 2. IP-диапазоны ЮKassa — log-only вторая линия.
 * 3. Телу НЕ доверяем: берём object.id → GET /v3/payments/{id} → решение
 *    по актуальному статусу из API (внутри syncPaymentByProviderId).
 *
 * Ответы: 200 — обработано/no-op; 5xx — ошибка обработки, ЮKassa ретраит
 * с нарастающим интервалом 24 часа (плюс reconciliation-cron как страховка).
 */

function safeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length, 32);
  const aBuf = Buffer.alloc(maxLen);
  const bBuf = Buffer.alloc(maxLen);
  aBuf.write(a);
  bBuf.write(b);
  return timingSafeEqual(aBuf, bBuf) && a.length === b.length;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ secret: string }> }
) {
  const configuredSecret = process.env.YOOKASSA_WEBHOOK_SECRET ?? "";
  if (!configuredSecret) {
    // Fail-secure: без секрета уведомления не принимаем вообще.
    return apiError("WEBHOOK_NOT_CONFIGURED", "Webhook secret is not configured", 503);
  }

  const { secret } = await params;
  if (!safeCompare(secret, configuredSecret)) {
    return apiError("UNAUTHORIZED", "Invalid webhook secret", 401);
  }

  const clientIp = extractClientIp(request.headers);
  if (clientIp && !isYooKassaIp(clientIp)) {
    await log.warn("payments", "Вебхук с IP вне диапазонов ЮKassa", { clientIp });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_BODY", "Malformed JSON", 400);
  }

  const parsed = yooWebhookNotificationSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("INVALID_BODY", "Unexpected notification shape", 400);
  }

  const { event, object } = parsed.data;
  if (!(HANDLED_WEBHOOK_EVENTS as readonly string[]).includes(event)) {
    return apiResponse({ skipped: true });
  }

  try {
    if (event.startsWith("payment.")) {
      await syncPaymentByProviderId(object.id);
    } else if (event === "refund.succeeded") {
      await syncRefundByProviderId(object.id);
    }
    return apiResponse({ processed: true });
  } catch (err) {
    await log.error("payments", "Ошибка обработки вебхука ЮKassa", {
      event,
      objectId: object.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiServerError();
  }
}
