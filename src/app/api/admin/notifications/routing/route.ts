import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";
import type { Prisma } from "@prisma/client";

/** Categories that can have their own chat routing. */
const ROUTING_CATEGORIES = [
  {
    key: "gazebos",
    label: "Барбекю Парк",
    description: "Бронирования беседок и мангальных зон",
    icon: "🏕",
  },
  {
    key: "ps-park",
    label: "Плей Парк",
    description: "Бронирования PlayStation-столов",
    icon: "🎮",
  },
  {
    key: "cafe",
    label: "Кафе",
    description: "Заказы еды и напитков",
    icon: "☕",
  },
  {
    key: "rental",
    label: "Аренда",
    description: "Заявки на аренду, договоры",
    icon: "🏢",
  },
  {
    key: "inventory",
    label: "Склад",
    description: "Приёмки, списания, низкие остатки",
    icon: "📋",
  },
  {
    key: "feedback",
    label: "Обратная связь",
    description: "Обращения от пользователей (баги, предложения)",
    icon: "💬",
  },
  {
    key: "system",
    label: "Системные алерты",
    description: "Health check, ошибки, критичные события",
    icon: "🔍",
  },
] as const;

type RoutingRule = {
  key: string;
  label: string;
  description: string;
  icon: string;
  chatId: string | null;
  chatTitle: string | null;
  usesGlobal: boolean;
};

/**
 * GET /api/admin/notifications/routing
 * Returns routing rules per category with their configured chat IDs.
 */
export async function GET() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    // Load all modules
    const modules = await prisma.module.findMany({
      where: {
        slug: {
          in: ROUTING_CATEGORIES.map((c) => c.key),
        },
      },
      select: { slug: true, config: true },
    });

    const moduleMap = new Map(modules.map((m) => [m.slug, m]));

    // Get global fallback
    const systemModule = moduleMap.get("system");
    const systemConfig =
      (systemModule?.config as Record<string, unknown>) || {};
    const globalChatId =
      (systemConfig.telegramAdminChatId as string) ||
      process.env.TELEGRAM_ADMIN_CHAT_ID ||
      "";
    const globalChatTitle =
      (systemConfig.telegramAdminChatTitle as string) || null;

    const rules: RoutingRule[] = ROUTING_CATEGORIES.map((cat) => {
      const mod = moduleMap.get(cat.key);
      const config = (mod?.config as Record<string, unknown>) || {};
      const moduleChatId = config.telegramAdminChatId as string | undefined;
      const moduleChatTitle = config.telegramAdminChatTitle as string | undefined;

      return {
        key: cat.key,
        label: cat.label,
        description: cat.description,
        icon: cat.icon,
        chatId: moduleChatId || null,
        chatTitle: moduleChatTitle || null,
        usesGlobal: !moduleChatId,
      };
    });

    return apiResponse({
      rules,
      global: {
        chatId: globalChatId,
        chatTitle: globalChatTitle,
      },
    });
  } catch (error) {
    console.error("[NotificationRouting] GET error:", error);
    return apiServerError();
  }
}

/**
 * PUT /api/admin/notifications/routing
 * Update chat ID for a specific module/category.
 * Body: { key: string, chatId: string | null }
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    const body = await request.json();
    const { key, chatId, chatTitle } = body;

    if (!key || typeof key !== "string") {
      return apiError("VALIDATION_ERROR", "key is required");
    }

    const validKeys: string[] = ROUTING_CATEGORIES.map((c) => c.key);
    if (!validKeys.includes(key)) {
      return apiError("VALIDATION_ERROR", `Invalid category: ${key}`);
    }

    if (chatId !== null && chatId !== undefined && typeof chatId !== "string") {
      return apiError("VALIDATION_ERROR", "chatId must be a string or null");
    }

    // Upsert module with updated config
    const existing = await prisma.module.findUnique({
      where: { slug: key },
    });

    const existingConfig =
      (existing?.config as Record<string, unknown>) || {};

    // If chatId is null/empty, remove the key to fall back to global
    const newConfig = { ...existingConfig };
    if (chatId) {
      newConfig.telegramAdminChatId = chatId;
    } else {
      delete newConfig.telegramAdminChatId;
    }
    if (chatTitle !== undefined) {
      if (chatTitle) {
        newConfig.telegramAdminChatTitle = chatTitle;
      } else {
        delete newConfig.telegramAdminChatTitle;
      }
    }

    const configValue = newConfig as Prisma.InputJsonValue;

    if (existing) {
      await prisma.module.update({
        where: { slug: key },
        data: { config: configValue },
      });
    } else {
      // Create module record if it doesn't exist (for feedback, inventory, etc.)
      const cat = ROUTING_CATEGORIES.find((c) => c.key === key)!;
      await prisma.module.create({
        data: {
          slug: key,
          name: cat.label,
          description: cat.description,
          isActive: true,
          config: configValue,
        },
      });
    }

    await logAudit(
      session!.user!.id!,
      "notification.routing.update",
      "Module",
      key,
      { chatId, chatTitle }
    );

    return apiResponse({ key, chatId: chatId || null, chatTitle: chatTitle || null });
  } catch (error) {
    console.error("[NotificationRouting] PUT error:", error);
    return apiServerError();
  }
}
