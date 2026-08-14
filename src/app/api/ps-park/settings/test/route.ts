import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
  apiNotFound,
  requireAdminSection,
} from "@/lib/api-response";
import { channelTestMessageSchema } from "@/modules/ps-park/validation";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { telegramApi } from "@/lib/telegram/client";
import { escapeHtml } from "@/lib/telegram/escape";

const MODULE_SLUG = "ps-park";

/**
 * POST /api/ps-park/settings/test
 * Отправляет тестовое сообщение в выделенный Telegram-канал PS Park, чтобы
 * админ проверил, что бот в группе и chat ID верный.
 * Body: { chatId?: string } — переопределяет сохранённый telegramChannelId.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "ps-park");
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
      "Канал уведомлений «Плей Парк» настроен правильно.",
      `Отправил: ${escapeHtml(userName)}`,
    ].join("\n");

    const tgRes = await telegramApi<{ chat?: { title?: string } }>(
      "sendMessage",
      { chat_id: chatId, text, parse_mode: "HTML" },
      { botToken: token }
    );

    if (!tgRes.ok && tgRes.transportError) {
      console.error("[PSParkChannel] Telegram API unreachable:", tgRes.description);
      return apiError(
        "TELEGRAM_UNREACHABLE",
        "Сервер не смог соединиться с Telegram API (таймаут или сетевая ошибка). Это проблема сети на сервере, а не ошибка настроек — запустите workflow «Telegram Diagnose» или проверьте доступ к Telegram API с VPS.",
        502
      );
    }

    if (!tgRes.ok) {
      return apiError(
        "TELEGRAM_ERROR",
        tgRes.description || "Ошибка отправки в Telegram"
      );
    }

    return apiResponse({
      chatId,
      chatTitle: tgRes.result?.chat?.title ?? null,
    });
  } catch (error) {
    console.error("[PSParkChannel] Test message error:", error);
    return apiServerError();
  }
}
