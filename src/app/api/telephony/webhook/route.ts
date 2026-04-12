import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/api-response";
import { handleWebhook } from "@/modules/telephony/service";
import { novofonWebhookSchema } from "@/modules/telephony/validation";
import { verifyNovofonSignature } from "@/modules/telephony/novofon-client";

/**
 * POST /api/telephony/webhook — receive Novofon events
 * Protected by HMAC signature (X-Novofon-Signature header).
 * No session required — called by Novofon servers.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("X-Novofon-Signature");
    const webhookSecret = process.env.NOVOFON_WEBHOOK_SECRET ?? "";

    // Verify signature if secret is configured
    if (webhookSecret) {
      const isValid = await verifyNovofonSignature(rawBody, signature, webhookSecret);
      if (!isValid) {
        return apiError("INVALID_SIGNATURE", "Подпись вебхука недействительна", 401);
      }
    }

    const body = JSON.parse(rawBody) as unknown;
    const parsed = novofonWebhookSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("VALIDATION_ERROR", "Некорректный payload вебхука", 400);
    }

    await handleWebhook(parsed.data);

    return apiResponse({ processed: true });
  } catch (error) {
    console.error("[telephony/webhook] Error:", error);
    return apiError("WEBHOOK_ERROR", "Ошибка обработки вебхука", 500);
  }
}
