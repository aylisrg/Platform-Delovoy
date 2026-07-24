import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";
import { telegramApi } from "@/lib/telegram/client";
import { buildChannelTestMessage } from "@/lib/telegram/test-message";
import {
  ROUTING_CATEGORIES,
  labelForCategory,
} from "@/modules/notifications/routing-categories";
import {
  channelTestSchema,
  moduleChannelUpdateSchema,
  MODULE_CHANNEL_SLUGS,
} from "@/modules/notifications/validation";
import { GAZEBO_CHANNEL_EVENTS } from "@/modules/gazebos/validation";
import { PS_PARK_CHANNEL_EVENTS } from "@/modules/ps-park/validation";
import type { Prisma } from "@prisma/client";

const CHANNEL_EVENT_CATALOG: Record<string, { type: string; label: string }[]> = {
  gazebos: GAZEBO_CHANNEL_EVENTS,
  "ps-park": PS_PARK_CHANNEL_EVENTS,
};

/**
 * Manual "test" send for the monitoring page channel panel.
 *
 * GET  → status of the dedicated per-module broadcast channels (gazebos,
 *        ps-park). Routing categories are listed by GET /api/admin/notifications/routing.
 * POST → send the unified test message to one channel (routing category admin
 *        chat OR a module's dedicated channel), so the admin can verify delivery.
 *
 * Deliberately a separate path from the existing test endpoints: those carry
 * their own richer wording and must keep working unchanged.
 */

type ModuleConfig = Record<string, unknown>;

function readConfig(config: unknown): ModuleConfig {
  return (config as ModuleConfig | null) ?? {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function iconForKey(key: string): string {
  return ROUTING_CATEGORIES.find((c) => c.key === key)?.icon ?? "📣";
}

export async function GET() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    const modules = await prisma.module.findMany({
      where: { slug: { in: [...MODULE_CHANNEL_SLUGS] } },
      select: { slug: true, config: true },
    });
    const bySlug = new Map(modules.map((m) => [m.slug, m]));

    const moduleChannels = MODULE_CHANNEL_SLUGS.map((slug) => {
      const config = readConfig(bySlug.get(slug)?.config);
      const chatId = readString(config.telegramChannelId);
      const channelName = readString(config.telegramChannelName);
      const enabledEvents = Array.isArray(config.telegramChannelEvents)
        ? (config.telegramChannelEvents as string[])
        : [];
      const events = (CHANNEL_EVENT_CATALOG[slug] ?? []).map((e) => ({
        type: e.type,
        label: e.label,
        enabled: enabledEvents.includes(e.type),
      }));
      return {
        slug,
        label: labelForCategory(slug),
        icon: iconForKey(slug),
        enabled: config.telegramChannelEnabled === true,
        configured: Boolean(chatId),
        chatId: chatId || null,
        channelName: channelName || null,
        usesOwnBot: Boolean(readString(config.telegramBotToken)),
        events,
      };
    });

    return apiResponse({ moduleChannels });
  } catch (error) {
    console.error("[ChannelTest] GET error:", error);
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    const envToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!envToken) {
      return apiError("BOT_NOT_CONFIGURED", "TELEGRAM_BOT_TOKEN не настроен");
    }

    const body = await request.json().catch(() => ({}));
    const parsed = channelTestSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    // Resolve destination chat + bot token + human-readable channel name.
    let chatId: string;
    let botToken: string;
    let channelName: string;

    if (parsed.data.kind === "routing") {
      const { key } = parsed.data;
      channelName = labelForCategory(key);
      botToken = envToken;

      const mod = await prisma.module.findUnique({
        where: { slug: key },
        select: { config: true },
      });
      chatId = readString(readConfig(mod?.config).telegramAdminChatId);

      if (!chatId) {
        const systemMod = await prisma.module.findUnique({
          where: { slug: "system" },
          select: { config: true },
        });
        chatId =
          readString(readConfig(systemMod?.config).telegramAdminChatId) ||
          readString(process.env.TELEGRAM_ADMIN_CHAT_ID);
      }

      if (!chatId) {
        return apiError(
          "NO_CHAT_ID",
          `Нет Chat ID для «${channelName}» — задайте свой чат категории или глобальный`
        );
      }
    } else {
      const { slug } = parsed.data;
      const label = labelForCategory(slug);

      const mod = await prisma.module.findUnique({
        where: { slug },
        select: { config: true },
      });
      const config = readConfig(mod?.config);

      chatId = readString(config.telegramChannelId);
      if (!chatId) {
        return apiError(
          "NO_CHAT_ID",
          `Для канала «${label}» не задан ID — укажите его в настройках модуля`
        );
      }

      const savedName = readString(config.telegramChannelName);
      channelName = savedName || `${label} (канал модуля)`;
      botToken = readString(config.telegramBotToken) || envToken;
    }

    const text = buildChannelTestMessage(channelName);
    const tgRes = await telegramApi<{ chat?: { title?: string } }>(
      "sendMessage",
      { chat_id: chatId, text, parse_mode: "HTML" },
      { botToken }
    );

    if (!tgRes.ok) {
      if (tgRes.transportError) {
        return apiError(
          "TELEGRAM_UNREACHABLE",
          "Сервер не смог соединиться с Telegram API. Это проблема сети на сервере — запустите workflow «Telegram Diagnose».",
          502
        );
      }
      return apiError(
        "TELEGRAM_ERROR",
        tgRes.description || "Ошибка отправки в Telegram"
      );
    }

    return apiResponse({
      sent: true,
      chatId,
      chatTitle: tgRes.result?.chat?.title ?? null,
      channelName,
    });
  } catch (error) {
    console.error("[ChannelTest] POST error:", error);
    return apiServerError();
  }
}

/**
 * PATCH /api/admin/notifications/channel-test
 * Edit a dedicated module channel's master switch and/or enabled event list
 * directly from the monitoring page's channel matrix.
 * Body: { slug: "gazebos"|"ps-park", telegramChannelEnabled?: boolean, telegramChannelEvents?: string[] }
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    const body = await request.json().catch(() => ({}));
    const parsed = moduleChannelUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const { slug, telegramChannelEnabled, telegramChannelEvents } = parsed.data;

    if (telegramChannelEvents) {
      const allowed = new Set(
        (CHANNEL_EVENT_CATALOG[slug] ?? []).map((e) => e.type)
      );
      const unknown = telegramChannelEvents.filter((t) => !allowed.has(t));
      if (unknown.length > 0) {
        return apiValidationError(`Unknown event type(s): ${unknown.join(", ")}`);
      }
    }

    const existing = await prisma.module.findUnique({ where: { slug } });
    if (!existing) {
      return apiError("NOT_FOUND", `Module "${slug}" not found`, 404);
    }

    const currentConfig = (existing.config as Record<string, unknown>) ?? {};
    const newConfig = { ...currentConfig };
    if (telegramChannelEnabled !== undefined) {
      newConfig.telegramChannelEnabled = telegramChannelEnabled;
    }
    if (telegramChannelEvents !== undefined) {
      newConfig.telegramChannelEvents = telegramChannelEvents;
    }

    await prisma.module.update({
      where: { slug },
      data: { config: newConfig as Prisma.InputJsonValue },
    });

    await logAudit(
      session!.user!.id!,
      "notification.module-channel.update",
      "Module",
      slug,
      { telegramChannelEnabled, telegramChannelEvents }
    );

    return apiResponse({
      slug,
      enabled: newConfig.telegramChannelEnabled === true,
      events: newConfig.telegramChannelEvents ?? [],
    });
  } catch (error) {
    console.error("[ChannelTest] PATCH error:", error);
    return apiServerError();
  }
}
