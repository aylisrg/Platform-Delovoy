import { apiResponse, apiError, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { telegramApi } from "@/lib/telegram/client";
import { escapeHtml } from "@/lib/telegram/escape";

/**
 * POST /api/admin/telegram/test — send a test message to the admin chat.
 */
export async function POST() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return apiError("BOT_NOT_CONFIGURED", "TELEGRAM_BOT_TOKEN не настроен");
    }

    // Get admin chat ID from DB first, fallback to env
    const systemModule = await prisma.module.findUnique({
      where: { slug: "system" },
      select: { config: true },
    });
    const config = (systemModule?.config as Record<string, unknown>) || {};
    const chatId = (config.telegramAdminChatId as string) || process.env.TELEGRAM_ADMIN_CHAT_ID;

    if (!chatId) {
      return apiError("CHAT_NOT_CONFIGURED", "ID группы администраторов не указан");
    }

    const text =
      `<b>Platform Delovoy</b>\n\n` +
      `Тестовое сообщение от админ-панели.\n` +
      `Отправил: ${escapeHtml(session!.user!.name || session!.user!.email || "Admin")}\n` +
      `<i>${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}</i>`;

    const res = await telegramApi<{ chat?: { type?: string; title?: string; first_name?: string } }>(
      "sendMessage",
      { chat_id: chatId, text, parse_mode: "HTML" },
      { botToken }
    );

    if (!res.ok) {
      if (res.transportError) {
        return apiError(
          "TELEGRAM_UNREACHABLE",
          "Сервер не смог соединиться с Telegram API. Это проблема сети на сервере — запустите workflow «Telegram Diagnose».",
          502
        );
      }
      // Provide helpful error messages
      if (res.description.includes("chat not found")) {
        return apiError("CHAT_NOT_FOUND", "Чат не найден. Убедитесь, что бот добавлен в группу и ID указан верно.");
      }
      if (res.description.includes("bot was kicked")) {
        return apiError("BOT_KICKED", "Бот был удалён из чата. Добавьте его обратно.");
      }
      return apiError("TELEGRAM_ERROR", res.description || "Ошибка отправки");
    }

    // Save chat title if available
    if (res.result?.chat?.title) {
      const existingConfig = (systemModule?.config as Record<string, unknown>) || {};
      await prisma.module.upsert({
        where: { slug: "system" },
        update: { config: { ...existingConfig, telegramAdminChatId: chatId, telegramAdminChatTitle: res.result.chat.title } },
        create: { slug: "system", name: "System", isActive: true, config: { telegramAdminChatId: chatId, telegramAdminChatTitle: res.result.chat.title } },
      });
    }

    return apiResponse({
      sent: true,
      chatType: res.result?.chat?.type,
      chatTitle: res.result?.chat?.title || res.result?.chat?.first_name,
    });
  } catch (error) {
    console.error("[Admin Telegram] Test error:", error);
    return apiServerError();
  }
}
