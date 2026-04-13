import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

/**
 * POST /api/ps-park/session-ending-alert
 *
 * Called by the admin panel when an active session has ≤10 minutes remaining.
 * Sends a Telegram alert to the admin chat so the manager can notify
 * players about extending their session.
 *
 * Body: { bookingId: string, resourceName: string, clientName: string, remainingMinutes: number }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bookingId, resourceName, clientName, remainingMinutes } = body as {
      bookingId: string;
      resourceName: string;
      clientName: string;
      remainingMinutes: number;
    };

    if (!resourceName || !bookingId) {
      return apiError("VALIDATION_ERROR", "bookingId and resourceName are required", 422);
    }

    const message = [
      `⏰ <b>Осталось ${remainingMinutes ?? 10} мин</b>`,
      ``,
      `🖥 Стол: <b>${resourceName}</b>`,
      clientName ? `👤 Клиент: ${clientName}` : null,
      ``,
      `Пора предложить продление!`,
    ]
      .filter(Boolean)
      .join("\n");

    let sent = false;

    if (BOT_TOKEN && ADMIN_CHAT_ID) {
      const res = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: ADMIN_CHAT_ID,
            text: message,
            parse_mode: "HTML",
          }),
        }
      );
      sent = res.ok;
    }

    return apiResponse({ sent });
  } catch {
    return apiServerError();
  }
}
