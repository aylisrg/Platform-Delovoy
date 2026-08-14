/**
 * Telegram Bot — @DelovoyPark_bot
 *
 * Main entry point for the Platform Delovoy Telegram bot.
 * Handles: bookings (gazebos, Плей Парк), cafe menu, notifications, admin alerts.
 *
 * Usage:
 *   npx tsx bot/index.ts
 */

import { Bot, InlineKeyboard } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import { registerGazeboHandlers } from "./handlers/gazebos";
import { registerPSParkHandlers } from "./handlers/ps-park";
import { registerCafeHandlers } from "./handlers/cafe";
import { registerMyBookingsHandler } from "./handlers/my-bookings";
import { handleLinkDeepLink } from "./handlers/link";
import {
  AUTH_DEEPLINK_PREFIX,
  handleAuthDeepLink,
  registerAuthDeepLinkHandlers,
} from "./handlers/auth-deeplink";
import { registerTeamSettingsHandlers } from "./handlers/team-settings";
import { buildWelcomeText, mainMenuKeyboard } from "./handlers/welcome";
import { registerUnknownTextHandler } from "./handlers/unknown";
import { mintBotLoginUrl } from "./lib/bot-login";
import { prisma } from "../src/lib/db";
import { logEvent } from "../src/lib/logger";
import { getTelegramApiRoot, getTelegramProxyUrl, telegramApi } from "../src/lib/telegram/client";
import { writeHeartbeat } from "../src/lib/telegram/heartbeat";
import { escapeHtml } from "../src/lib/telegram/escape";

// On staging we prefer a dedicated bot + chat so that real clients don't receive
// test events. Fall back to the default env if staging-specific values aren't set
// (e.g. early staging bootstrap) — but the staging compose supplies them.
const IS_STAGING =
  process.env.NODE_ENV === "staging" || process.env.NEXT_PUBLIC_ENV === "staging";
const BOT_TOKEN = IS_STAGING
  ? process.env.TELEGRAM_STAGING_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
  : process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = IS_STAGING
  ? process.env.TELEGRAM_STAGING_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID
  : process.env.TELEGRAM_ADMIN_CHAT_ID;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

type AlertLevel = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

const LEVEL_EMOJI: Record<AlertLevel, string> = {
  INFO: "ℹ️",
  WARNING: "⚠️",
  ERROR: "🔴",
  CRITICAL: "🚨",
};

/**
 * Send an alert message to the admin Telegram group.
 * Can be imported by other modules without starting the bot.
 */
export async function sendAlert(
  level: AlertLevel,
  source: string,
  message: string,
  details?: string
): Promise<boolean> {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.warn("[Bot] TELEGRAM_BOT_TOKEN or TELEGRAM_ADMIN_CHAT_ID not set, skipping alert");
    return false;
  }

  const emoji = LEVEL_EMOJI[level];
  // #534: source/message/details в конечном счёте могут нести данные,
  // затронутые пользовательским вводом (например, текст ошибки, включающий
  // чьё-то имя) — экранируем сплошняком, а не выборочно по провенансу.
  const text = [
    `${emoji} <b>[${level}]</b> ${escapeHtml(source)}`,
    ``,
    escapeHtml(message),
    details ? `\n<pre>${escapeHtml(details)}</pre>` : "",
    `\n<i>${new Date().toISOString()}</i>`,
  ].join("\n");

  const response = await telegramApi(
    "sendMessage",
    { chat_id: ADMIN_CHAT_ID, text, parse_mode: "HTML" },
    { botToken: BOT_TOKEN }
  );

  if (!response.ok) {
    console.error("[Bot] Failed to send alert:", response.description);
    return false;
  }

  return true;
}

const WEBAPP_URL = `${APP_URL}/webapp`;

/**
 * Start the bot in long-polling mode.
 */
async function startBot() {
  if (!BOT_TOKEN) {
    console.error("[Bot] TELEGRAM_BOT_TOKEN is required");
    process.exit(1);
  }

  // Safety net: на staging требуем явно заданный TELEGRAM_STAGING_BOT_TOKEN,
  // иначе стейдж может начать отвечать под именем прод-бота реальным клиентам.
  if (IS_STAGING && !process.env.TELEGRAM_STAGING_BOT_TOKEN) {
    console.warn(
      "[Bot] NODE_ENV=staging но TELEGRAM_STAGING_BOT_TOKEN не задан — бот НЕ запускается, чтобы не отвечать прод-клиентам."
    );
    return;
  }

  // TELEGRAM_API_ROOT / TELEGRAM_PROXY_URL — обходные пути, когда VPS не может
  // достучаться до api.telegram.org напрямую (см. runbook в DEPLOYMENT.md).
  // grammy на Node ходит через node-fetch, поэтому прокси задаётся через agent.
  const proxyUrl = getTelegramProxyUrl();
  const bot = new Bot(BOT_TOKEN, {
    client: {
      apiRoot: getTelegramApiRoot(),
      ...(proxyUrl
        ? { baseFetchConfig: { compress: true, agent: new HttpsProxyAgent(proxyUrl) } }
        : {}),
    },
  });

  // /start — main menu (supports deep linking: /start gazebos, /start ps-park)
  bot.command("start", async (ctx) => {
    const deepLink = ctx.match?.trim();

    // Handle deep links
    if (deepLink?.startsWith(AUTH_DEEPLINK_PREFIX)) {
      await handleAuthDeepLink(ctx, deepLink);
      return;
    }

    if (deepLink?.startsWith("link_")) {
      await handleLinkDeepLink(ctx, deepLink);
      return;
    }

    if (deepLink === "gazebos") {
      await ctx.reply(
        "🏕 *Барбекю Парк бизнес\\-парка «Деловой»*\n\nВыберите действие:",
        {
          parse_mode: "MarkdownV2",
          reply_markup: new InlineKeyboard()
            .text("📅 Забронировать", "gazebos:list")
            .row()
            .text("← Главное меню", "menu:main"),
        }
      );
      return;
    }

    if (deepLink === "ps-park" || deepLink === "ps") {
      await ctx.reply(
        "🎮 *Плей Парк*\n\nВыберите действие:",
        {
          parse_mode: "MarkdownV2",
          reply_markup: new InlineKeyboard()
            .text("📅 Забронировать стол", "pspark:list")
            .row()
            .text("← Главное меню", "menu:main"),
        }
      );
      return;
    }

    if (deepLink === "webapp") {
      // Open Mini App directly
      await ctx.reply(
        "📱 Откройте приложение для бронирования:",
        {
          reply_markup: new InlineKeyboard()
            .webApp("📱 Открыть приложение", WEBAPP_URL)
            .row()
            .text("← Главное меню", "menu:main"),
        }
      );
      return;
    }

    // Default welcome — personalized greeting for both new and returning users.
    // If the user already has a linked web account (User.telegramId), mint a
    // one-time bot→web login URL so a click lands them straight into a session.
    // Any failure (404 / network / timeout) gracefully falls back to APP_URL.
    const tgId = ctx.from?.id != null ? String(ctx.from.id) : null;
    let loginUrl: string | null = null;
    let isReturning = false;
    if (tgId) {
      try {
        const linkedUser = await prisma.user.findUnique({
          where: { telegramId: tgId },
          select: { id: true },
        });
        if (linkedUser) {
          loginUrl = await mintBotLoginUrl(tgId);
          isReturning = true;
        }
      } catch (err) {
        console.warn("[Bot] failed to resolve telegram user for auto-login:", err);
      }
    }

    await ctx.reply(buildWelcomeText(ctx.from?.first_name, isReturning), {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(loginUrl ?? undefined),
    });
  });

  // /help
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `<b>Команды бота:</b>\n\n` +
        `/start — Главное меню\n` +
        `/gazebos — Барбекю Парк\n` +
        `/ps — Плей Парк\n` +
        `/cafe — Меню кафе\n` +
        `/mybookings — Мои бронирования\n` +
        `/settings — Настройки (для команды парка)\n` +
        `/help — Эта справка\n\n` +
        `По вопросам: позвоните администратору парка или напишите на сайте.`,
      { parse_mode: "HTML" }
    );
  });

  // Main menu callback
  bot.callbackQuery("menu:main", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `<b>Бизнес-парк «Деловой»</b>\n\nВыберите, что вас интересует:`,
      {
        parse_mode: "HTML",
        reply_markup: mainMenuKeyboard(),
      }
    );
  });

  // NOTE: Per-module "menu:*" callbacks (menu:gazebos, menu:ps-park, menu:cafe,
  // menu:my-bookings) are intentionally NOT registered here. Each domain handler
  // below owns its own callback so the user actually lands on a list/menu
  // instead of an empty answerCallbackQuery() ack.

  // Register module handlers
  registerGazeboHandlers(bot);
  registerPSParkHandlers(bot);
  registerCafeHandlers(bot);
  registerMyBookingsHandler(bot);
  registerTeamSettingsHandlers(bot);
  registerAuthDeepLinkHandlers(bot);

  // Catch-all for unknown text — MUST be registered LAST so it only fires
  // when no command or domain handler matched the input.
  registerUnknownTextHandler(bot, logEvent);

  // Error handler
  bot.catch((err) => {
    console.error("[Bot] Error:", err);
  });

  // Heartbeat для docker healthcheck (см. src/lib/telegram/heartbeat.ts):
  // цикл раз в 60с делает getMe и по завершении пишет файл. Файл пишется и
  // при сетевой ошибке (рестарт не лечит блок сети) — ловим именно зависший
  // процесс: цикл перестал завершаться → файл стареет → autoheal рестартует.
  const HEARTBEAT_INTERVAL_MS = 60_000;
  const heartbeatTick = async () => {
    const me = await telegramApi("getMe", {}, { botToken: BOT_TOKEN, timeoutMs: 10_000 });
    if (!me.ok) {
      console.warn(`[Bot] heartbeat: getMe не прошёл (${me.description}) — транспорт к Telegram деградирован`);
    }
    await writeHeartbeat();
  };
  void heartbeatTick();
  const heartbeatTimer = setInterval(() => void heartbeatTick(), HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();

  // Start
  console.log("[Bot] Starting @DelovoyPark_bot...");
  await bot.start({
    onStart: () => console.log("[Bot] @DelovoyPark_bot is running"),
  });
}

// Run bot if executed directly
if (require.main === module) {
  startBot();
}
