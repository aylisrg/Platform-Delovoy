import { apiResponse, apiError, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";

/**
 * POST /api/admin/telegram/test-owner — send a test message to the owner's private chat.
 * Only SUPERADMIN can trigger this.
 */
export async function POST() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    if (session!.user!.role !== "SUPERADMIN") {
      return apiError("FORBIDDEN", "Только суперадмин может отправлять тестовые уведомления", 403);
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return apiError("BOT_NOT_CONFIGURED", "TELEGRAM_BOT_TOKEN не настроен");
    }

    const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID;
    if (!ownerChatId) {
      return apiError("OWNER_NOT_CONFIGURED", "TELEGRAM_OWNER_CHAT_ID не задан в .env");
    }

    const senderName = session!.user!.name || session!.user!.email || "Admin";
    const now = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });

    const text =
      `🔔 <b>Тестовое уведомление</b>\n\n` +
      `Это тестовое сообщение от @DelovoyPark_bot.\n` +
      `Отправил: ${senderName}\n\n` +
      `Если ты это видишь — личные уведомления владельцу работают.\n` +
      `<i>Platform Delovoy · ${now}</i>`;

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ownerChatId,
        text,
        parse_mode: "HTML",
      }),
    });

    const data = await res.json();

    if (!data.ok) {
      if (data.description?.includes("chat not found")) {
        return apiError("CHAT_NOT_FOUND", "Чат не найден. Проверьте TELEGRAM_OWNER_CHAT_ID. Бот должен быть запущен (/start) пользователем.");
      }
      if (data.description?.includes("bot was blocked")) {
        return apiError("BOT_BLOCKED", "Пользователь заблокировал бота. Нужно разблокировать @DelovoyPark_bot.");
      }
      return apiError("TELEGRAM_ERROR", data.description || "Ошибка отправки");
    }

    return apiResponse({
      sent: true,
      chatId: ownerChatId,
      recipientName: data.result?.chat?.first_name
        ? `${data.result.chat.first_name} ${data.result.chat.last_name || ""}`.trim()
        : undefined,
      recipientUsername: data.result?.chat?.username,
    });
  } catch (error) {
    console.error("[Admin Telegram] Test-owner error:", error);
    return apiServerError();
  }
}
