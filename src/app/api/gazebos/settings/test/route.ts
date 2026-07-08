import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
  apiNotFound,
  requireAdminSection,
} from "@/lib/api-response";
import { channelTestMessageSchema } from "@/modules/gazebos/validation";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";

const MODULE_SLUG = "gazebos";

/**
 * POST /api/gazebos/settings/test
 * Send a test message to the dedicated gazebos Telegram channel so the admin
 * can verify the bot is in the group and the chat ID is correct.
 * Body: { chatId?: string } — overrides the saved telegramChannelId.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "gazebos");
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    const parsed = channelTestMessageSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const moduleRecord = await prisma.module.findUnique({
      where: { slug: MODULE_SLUG },
      select: { config: true },
    });
    if (!moduleRecord) return apiNotFound("Модуль не найден");
    const config = (moduleRecord.config as Record<string, unknown>) ?? {};

    const chatId =
      parsed.data.chatId?.trim() ||
      (typeof config.telegramChannelId === "string"
        ? config.telegramChannelId.trim()
        : "");
    if (!chatId) {
      return apiError("NO_CHAT_ID", "Укажите ID или @username канала");
    }

    const token =
      (typeof config.telegramBotToken === "string" && config.telegramBotToken) ||
      process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return apiError("BOT_NOT_CONFIGURED", "TELEGRAM_BOT_TOKEN не настроен");
    }

    const userName = session?.user?.name || "Администратор";
    const text = [
      "✅ <b>Тестовое сообщение</b>",
      "",
      "Канал уведомлений «Барбекю Парк» настроен правильно.",
      `Отправил: ${userName}`,
    ].join("\n");

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const tgData = await res.json();

    if (!tgData.ok) {
      return apiError(
        "TELEGRAM_ERROR",
        tgData.description || "Ошибка отправки в Telegram"
      );
    }

    return apiResponse({
      chatId,
      chatTitle: tgData.result?.chat?.title ?? null,
    });
  } catch (error) {
    console.error("[GazeboChannel] Test message error:", error);
    return apiServerError();
  }
}
