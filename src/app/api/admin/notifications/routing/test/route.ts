import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const CATEGORY_LABELS: Record<string, string> = {
  gazebos: "Барбекю Парк",
  "ps-park": "Плей Парк",
  cafe: "Кафе",
  rental: "Аренда",
  inventory: "Склад",
  feedback: "Обратная связь",
  system: "Системные алерты",
};

/**
 * POST /api/admin/notifications/routing/test
 * Send a test message to a specific category's chat.
 * Body: { key: string, chatId?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    if (!BOT_TOKEN) {
      return apiError("BOT_NOT_CONFIGURED", "TELEGRAM_BOT_TOKEN не настроен");
    }

    const body = await request.json();
    const { key, chatId: overrideChatId } = body;

    if (!key || typeof key !== "string") {
      return apiError("VALIDATION_ERROR", "key is required");
    }

    // Resolve chat ID: override → module config → global fallback
    let chatId = overrideChatId;

    if (!chatId) {
      const mod = await prisma.module.findUnique({
        where: { slug: key },
        select: { config: true },
      });
      const config = (mod?.config as Record<string, unknown>) || {};
      chatId = config.telegramAdminChatId as string;
    }

    if (!chatId) {
      const systemMod = await prisma.module.findUnique({
        where: { slug: "system" },
        select: { config: true },
      });
      const sysConfig = (systemMod?.config as Record<string, unknown>) || {};
      chatId =
        (sysConfig.telegramAdminChatId as string) ||
        process.env.TELEGRAM_ADMIN_CHAT_ID;
    }

    if (!chatId) {
      return apiError(
        "NO_CHAT_ID",
        "Нет Chat ID — укажите для этой категории или задайте глобальный"
      );
    }

    const label = CATEGORY_LABELS[key] || key;
    const userName = session?.user?.name || "Администратор";
    const text = [
      `✅ <b>Тестовое сообщение</b>`,
      ``,
      `Категория: <b>${label}</b>`,
      `Отправил: ${userName}`,
      ``,
      `Если вы видите это сообщение — маршрут «${label}» настроен правильно.`,
    ].join("\n");

    const tgResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
        }),
      }
    );

    const tgData = await tgResponse.json();

    if (!tgData.ok) {
      return apiError(
        "TELEGRAM_ERROR",
        tgData.description || "Ошибка отправки в Telegram"
      );
    }

    // Extract chat title from response
    const chatTitle = tgData.result?.chat?.title || null;

    // Auto-save chat title if we got one
    if (chatTitle) {
      const mod = await prisma.module.findUnique({
        where: { slug: key },
      });
      if (mod) {
        const existingConfig =
          (mod.config as Record<string, unknown>) || {};
        await prisma.module.update({
          where: { slug: key },
          data: {
            config: { ...existingConfig, telegramAdminChatTitle: chatTitle },
          },
        });
      }
    }

    return apiResponse({
      chatId,
      chatTitle,
      category: key,
    });
  } catch (error) {
    console.error("[NotificationRouting] Test error:", error);
    return apiServerError();
  }
}
