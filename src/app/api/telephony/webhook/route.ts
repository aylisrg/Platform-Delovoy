import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/api-response";
import { handleWebhook } from "@/modules/telephony/service";
import { normalizeNovofonWebhook } from "@/modules/telephony/validation";
import { verifyNovofonWebhook } from "@/modules/telephony/novofon-client";

/**
 * POST /api/telephony/webhook — receive Novofon events
 * Auth: shared secret (?token= or X-Webhook-Token, Novofon 2.0) or legacy
 * HMAC signature (X-Novofon-Signature). Accepts Novofon 2.0 notification
 * format ({notification_name, call_session_id, ...}) and legacy format.
 * No session required — called by Novofon servers.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const webhookSecret =
      process.env.NOVOFON_WEBHOOK_TOKEN || process.env.NOVOFON_WEBHOOK_SECRET || "";

    // Always verify signature — reject if secret not configured (fail-secure)
    if (!webhookSecret) {
      return apiError("WEBHOOK_NOT_CONFIGURED", "Вебхук не настроен (NOVOFON_WEBHOOK_TOKEN отсутствует)", 503);
    }

    // Optional IP allowlist (comma-separated), e.g. Novofon notification servers
    const allow = (process.env.NOVOFON_WEBHOOK_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (allow.length > 0) {
      const ip =
        request.headers.get("x-real-ip") ??
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        "";
      if (!allow.includes(ip)) {
        return apiError("FORBIDDEN_IP", "IP не в списке разрешённых", 403);
      }
    }

    const isValid = await verifyNovofonWebhook(rawBody, request.headers, request.url, webhookSecret);
    if (!isValid) {
      return apiError("INVALID_SIGNATURE", "Подпись вебхука недействительна", 401);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = Object.fromEntries(new URLSearchParams(rawBody));
    }
    const payload = normalizeNovofonWebhook(body);
    if (!payload) {
      const keys = body && typeof body === "object" ? Object.keys(body).join(",") : typeof body;
      console.warn("[telephony/webhook] unsupported payload, keys:", keys);
      return apiError("VALIDATION_ERROR", "Некорректный payload вебхука", 400);
    }

    await handleWebhook(payload);

    return apiResponse({ processed: true });
  } catch (error) {
    console.error("[telephony/webhook] Error:", error);
    return apiError("WEBHOOK_ERROR", "Ошибка обработки вебхука", 500);
  }
}
