import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";

const SYSTEM_MODULE_SLUG = "system";

type TelegramSettings = {
  adminChatId: string;
  adminChatTitle?: string;
  ownerChatId: string;
  botUsername: string;
  botToken: string; // masked
};

/**
 * GET /api/admin/telegram — get Telegram bot settings.
 */
export async function GET() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    const settings = await getTelegramSettings();
    return apiResponse(settings);
  } catch (error) {
    console.error("[Admin Telegram] GET error:", error);
    return apiServerError();
  }
}

/**
 * PUT /api/admin/telegram — update Telegram bot settings.
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    const body = await request.json();
    const { adminChatId, adminChatTitle } = body;

    if (adminChatId !== undefined && typeof adminChatId !== "string") {
      return apiError("VALIDATION_ERROR", "adminChatId must be a string");
    }

    // Get or create system module
    let systemModule = await prisma.module.findUnique({
      where: { slug: SYSTEM_MODULE_SLUG },
    });

    const existingConfig = (systemModule?.config as Record<string, unknown>) || {};
    const newConfig = {
      ...existingConfig,
      ...(adminChatId !== undefined && { telegramAdminChatId: adminChatId }),
      ...(adminChatTitle !== undefined && { telegramAdminChatTitle: adminChatTitle }),
    };

    if (!systemModule) {
      systemModule = await prisma.module.create({
        data: {
          slug: SYSTEM_MODULE_SLUG,
          name: "System",
          description: "Global platform settings",
          isActive: true,
          config: newConfig,
        },
      });
    } else {
      systemModule = await prisma.module.update({
        where: { slug: SYSTEM_MODULE_SLUG },
        data: { config: newConfig },
      });
    }

    await logAudit(session!.user!.id!, "telegram.settings.update", "Module", systemModule.id, {
      adminChatId,
      adminChatTitle,
    });

    const settings = await getTelegramSettings();
    return apiResponse(settings);
  } catch (error) {
    console.error("[Admin Telegram] PUT error:", error);
    return apiServerError();
  }
}

async function getTelegramSettings(): Promise<TelegramSettings> {
  const systemModule = await prisma.module.findUnique({
    where: { slug: SYSTEM_MODULE_SLUG },
    select: { config: true },
  });

  const config = (systemModule?.config as Record<string, unknown>) || {};
  const envChatId = process.env.TELEGRAM_ADMIN_CHAT_ID || "";
  const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID || "";
  const botToken = process.env.TELEGRAM_BOT_TOKEN || "";

  return {
    adminChatId: (config.telegramAdminChatId as string) || envChatId,
    adminChatTitle: (config.telegramAdminChatTitle as string) || undefined,
    ownerChatId,
    botUsername: process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME || "",
    botToken: botToken ? `${botToken.slice(0, 6)}...${botToken.slice(-4)}` : "",
  };
}
