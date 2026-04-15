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
import { registerGazeboHandlers } from "./handlers/gazebos";
import { registerPSParkHandlers } from "./handlers/ps-park";
import { registerCafeHandlers } from "./handlers/cafe";
import { registerMyBookingsHandler } from "./handlers/my-bookings";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
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
  const text = [
    `${emoji} <b>[${level}]</b> ${source}`,
    ``,
    message,
    details ? `\n<pre>${details}</pre>` : "",
    `\n<i>${new Date().toISOString()}</i>`,
  ].join("\n");

  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text,
        parse_mode: "HTML",
      }),
    });

    if (!response.ok) {
      console.error("[Bot] Failed to send alert:", await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error("[Bot] Error sending alert:", error);
    return false;
  }
}

const WEBAPP_URL = `${APP_URL}/webapp`;

/**
 * Build the main menu keyboard.
 */
function mainMenuKeyboard() {
  return new InlineKeyboard()
    .webApp("📱 Открыть приложение", WEBAPP_URL)
    .row()
    .text("🏕 Барбекю Парк", "menu:gazebos")
    .text("🎮 Плей Парк", "menu:ps-park")
    .row()
    .text("📋 Мои брони", "menu:my-bookings")
    .row()
    .url("🌐 Открыть сайт", APP_URL);
}

/**
 * Start the bot in long-polling mode.
 */
async function startBot() {
  if (!BOT_TOKEN) {
    console.error("[Bot] TELEGRAM_BOT_TOKEN is required");
    process.exit(1);
  }

  const bot = new Bot(BOT_TOKEN);

  // /start — main menu (supports deep linking: /start gazebos, /start ps-park)
  bot.command("start", async (ctx) => {
    const deepLink = ctx.match?.trim();

    // Handle deep links
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

    // Default welcome
    const userName = ctx.from?.first_name || "друг";
    await ctx.reply(
      `Привет, ${userName}! 👋\n\n` +
        `Я бот бизнес-парка <b>«Деловой»</b> (Селятино).\n\n` +
        `Через меня можно:\n` +
        `🏕 Забронировать беседку в Барбекю Парке\n` +
        `🎮 Забронировать стол в Плей Парке\n` +
        `📋 Проверить свои бронирования\n\n` +
        `📱 Нажмите <b>«Открыть приложение»</b> — полноценный интерфейс прямо в Telegram!\n\n` +
        `Или выберите, что вас интересует:`,
      {
        parse_mode: "HTML",
        reply_markup: mainMenuKeyboard(),
      }
    );
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

  // Menu routing callbacks
  bot.callbackQuery("menu:gazebos", async (ctx) => {
    await ctx.answerCallbackQuery();
    // Will be handled by gazebo handler
  });

  bot.callbackQuery("menu:ps-park", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("menu:cafe", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("menu:my-bookings", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  // Register module handlers
  registerGazeboHandlers(bot);
  registerPSParkHandlers(bot);
  registerCafeHandlers(bot);
  registerMyBookingsHandler(bot);

  // Error handler
  bot.catch((err) => {
    console.error("[Bot] Error:", err);
  });

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
