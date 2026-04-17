import { auth } from "@/lib/auth";
import {
  apiResponse,
  requireAdminSection,
  apiServerError,
} from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { EVENT_ROUTING } from "@/modules/notifications/events";
import { getModuleBotConfig } from "@/modules/notifications/service";

// Map event type prefixes to module slugs
const EVENT_MODULE_MAP: Record<string, string[]> = {
  gazebos: [
    "booking.created",
    "booking.confirmed",
    "booking.cancelled",
    "booking.reminder",
  ],
  "ps-park": [
    "booking.created",
    "booking.confirmed",
    "booking.cancelled",
    "booking.reminder",
  ],
  cafe: [
    "order.placed",
    "order.preparing",
    "order.ready",
    "order.delivered",
    "order.cancelled",
  ],
  rental: ["contract.created", "contract.expiring", "inquiry.created"],
};

// Human-readable event labels
const EVENT_LABELS: Record<string, string> = {
  "booking.created": "Новое бронирование",
  "booking.confirmed": "Бронирование подтверждено",
  "booking.cancelled": "Отмена бронирования",
  "booking.reminder": "Напоминание о бронировании",
  "order.placed": "Новый заказ",
  "order.preparing": "Заказ готовится",
  "order.ready": "Заказ готов",
  "order.delivered": "Заказ доставлен",
  "order.cancelled": "Заказ отменён",
  "contract.created": "Новый договор",
  "contract.expiring": "Истекающий договор",
  "inquiry.created": "Новая заявка на аренду",
};

// Module display names
const MODULE_NAMES: Record<string, string> = {
  gazebos: "Барбекю Парк",
  "ps-park": "Плей Парк",
  cafe: "Кафе",
  rental: "Аренда",
};

type EventStatus = "active" | "unconfigured" | "disabled";

/**
 * GET /api/admin/notifications/routing-map
 * Returns the full notification routing map with statuses.
 */
export async function GET() {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "telegram");
    if (denied) return denied;

    // Load all modules and their configs
    const modules = await prisma.module.findMany({
      select: { slug: true, name: true, isActive: true, config: true },
    });

    const moduleMap = new Map(modules.map((m) => [m.slug, m]));

    // Get global admin chat ID
    const systemModule = moduleMap.get("system");
    const systemConfig = (systemModule?.config as Record<string, unknown>) || {};
    const globalAdminChatId =
      (systemConfig.telegramAdminChatId as string) ||
      process.env.TELEGRAM_ADMIN_CHAT_ID ||
      "";

    const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID || "";
    const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || "DelovoyPark_bot";

    // Build sources
    const sources = [];
    let totalRoutes = 0;
    let activeRoutes = 0;
    let unconfiguredRoutes = 0;
    let disabledRoutes = 0;

    for (const [moduleSlug, eventTypes] of Object.entries(EVENT_MODULE_MAP)) {
      const mod = moduleMap.get(moduleSlug);
      const isModuleActive = mod?.isActive !== false;
      const config = await getModuleBotConfig(moduleSlug);
      const moduleChatId = config.telegramAdminChatId || globalAdminChatId;

      const events = eventTypes.map((eventType) => {
        const routing = EVENT_ROUTING[eventType];
        if (!routing) return null;

        totalRoutes++;

        let status: EventStatus;
        if (!isModuleActive) {
          status = "disabled";
          disabledRoutes++;
        } else if (routing.admin && !moduleChatId) {
          status = "unconfigured";
          unconfiguredRoutes++;
        } else {
          status = "active";
          activeRoutes++;
        }

        return {
          type: eventType,
          label: EVENT_LABELS[eventType] || eventType,
          targets: {
            client: routing.client,
            admin: routing.admin,
          },
          category: routing.category || null,
          status,
        };
      }).filter(Boolean);

      sources.push({
        moduleSlug,
        moduleName: MODULE_NAMES[moduleSlug] || mod?.name || moduleSlug,
        isActive: isModuleActive,
        events,
      });
    }

    // Recipients info
    const clientCount = await prisma.user.count({
      where: { telegramId: { not: null }, role: "USER" },
    });

    const recipients = {
      adminGroup: {
        type: "group" as const,
        label: "Группа администраторов",
        chatId: globalAdminChatId || null,
        chatTitle:
          (systemConfig.adminChatTitle as string) || null,
        status: (globalAdminChatId ? "active" : "unconfigured") as EventStatus,
      },
      owner: {
        type: "personal" as const,
        label: "Владелец",
        chatId: ownerChatId || null,
        status: (ownerChatId ? "active" : "unconfigured") as EventStatus,
      },
      clients: {
        type: "users" as const,
        label: "Клиенты",
        connectedCount: clientCount,
        channelPriority: ["TELEGRAM", "WHATSAPP", "EMAIL", "VK"],
        status: "active" as EventStatus,
      },
    };

    return apiResponse({
      summary: {
        total: totalRoutes,
        active: activeRoutes,
        unconfigured: unconfiguredRoutes,
        disabled: disabledRoutes,
      },
      sources,
      recipients,
      bot: {
        username: botUsername,
        tokenConfigured: !!botToken,
      },
    });
  } catch (error) {
    console.error("[RoutingMap] Error:", error);
    return apiServerError();
  }
}
