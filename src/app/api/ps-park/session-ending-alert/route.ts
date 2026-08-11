import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { telegramApi } from "@/lib/telegram/client";
import { escapeHtml } from "@/lib/telegram/escape";
import { sessionEndingAlertSchema } from "@/modules/ps-park/validation";

const MODULE_SLUG = "ps-park";

/**
 * POST /api/ps-park/session-ending-alert
 *
 * Дёргается админ-панелью, когда у активной сессии осталось ≤10 минут: шлёт
 * алерт в админ-чат Telegram, чтобы менеджер предложил продление.
 *
 * Body: { bookingId, resourceName, clientName?, remainingMinutes? }
 *
 * Раньше роут был публичным: без сессии, без Zod (голый каст тела) и с
 * подстановкой `resourceName`/`clientName` в сообщение с `parse_mode: "HTML"`
 * без экранирования. Любой мог спамить админ-чат и внедрять в него разметку —
 * фишинг против администратора. Отсюда все четыре слоя ниже.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, MODULE_SLUG);
    if (denied) return denied;

    const limited = await rateLimit(request, "authenticated", session?.user?.id);
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const parsed = sessionEndingAlertSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }
    const { resourceName, clientName, remainingMinutes } = parsed.data;

    // Экранируем всё, что пришло снаружи: сообщение уходит с parse_mode HTML.
    const message = [
      `⏰ <b>Осталось ${remainingMinutes ?? 10} мин</b>`,
      ``,
      `🖥 Стол: <b>${escapeHtml(resourceName)}</b>`,
      clientName ? `👤 Клиент: ${escapeHtml(clientName)}` : null,
      ``,
      `Пора предложить продление!`,
    ]
      .filter(Boolean)
      .join("\n");

    // Env читается внутри хендлера, а не на уровне модуля: так значение берётся
    // актуальное на момент запроса, а не то, что было при первом импорте.
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

    let sent = false;

    if (BOT_TOKEN && ADMIN_CHAT_ID) {
      const res = await telegramApi(
        "sendMessage",
        { chat_id: ADMIN_CHAT_ID, text: message, parse_mode: "HTML" },
        { botToken: BOT_TOKEN }
      );
      sent = res.ok;
    }

    return apiResponse({ sent });
  } catch {
    return apiServerError();
  }
}
