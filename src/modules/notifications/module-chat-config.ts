import { prisma } from "@/lib/db";
import type { ModuleBotConfig } from "./types";

/**
 * Module group-chat config (Module.config JSON) — shared by `notifyAdmin` and
 * the recipient resolver (`audience.ts`), kept out of service.ts to avoid an
 * import cycle.
 */

/**
 * Get Telegram bot config for a module from Module.config JSON.
 * Falls back to global env vars.
 */
export async function getModuleBotConfig(
  moduleSlug: string
): Promise<ModuleBotConfig> {
  try {
    const mod = await prisma.module.findUnique({
      where: { slug: moduleSlug },
      select: { config: true },
    });

    const config = mod?.config as Record<string, unknown> | null;
    return {
      telegramBotToken:
        (config?.telegramBotToken as string) || undefined,
      telegramAdminChatId:
        (config?.telegramAdminChatId as string) || undefined,
      telegramAdminChatEnabled: config?.telegramAdminChatEnabled === false ? false : true,
    };
  } catch {
    return {};
  }
}

/**
 * Get the global admin chat ID from DB (system module config), fallback to env.
 */
export async function getGlobalAdminChatId(): Promise<string | undefined> {
  try {
    const systemModule = await prisma.module.findUnique({
      where: { slug: "system" },
      select: { config: true },
    });
    const config = (systemModule?.config as Record<string, unknown>) || {};
    return (config.telegramAdminChatId as string) || process.env.TELEGRAM_ADMIN_CHAT_ID || undefined;
  } catch {
    return process.env.TELEGRAM_ADMIN_CHAT_ID || undefined;
  }
}
