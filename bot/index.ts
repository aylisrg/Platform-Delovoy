/**
 * Telegram Bot for Platform Delovoy.
 *
 * Dual-purpose:
 * 1. Alert bot — sends system alerts to admin group
 * 2. User bot — booking flow for gazebos (and future modules)
 *
 * Usage:
 *   npx tsx bot/index.ts    — run the bot
 */

import { Bot } from "grammy";
import { registerGazeboHandlers } from "./handlers/gazebos";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

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

/**
 * Start the bot in long-polling mode.
 */
async function startBot() {
  if (!BOT_TOKEN) {
    console.error("[Bot] TELEGRAM_BOT_TOKEN is required");
    process.exit(1);
  }

  const bot = new Bot(BOT_TOKEN);

  // Start command
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "👋 Добро пожаловать в бот бизнес-парка *Деловой*\\!\n\n" +
        "Доступные команды:\n" +
        "/gazebos — Забронировать беседку\n" +
        "/help — Помощь",
      { parse_mode: "MarkdownV2" }
    );
  });

  // Help command
  bot.command("help", async (ctx) => {
    await ctx.reply(
      "🔹 /gazebos — Посмотреть беседки и забронировать\n" +
        "🔹 /start — Начать сначала\n\n" +
        "По вопросам обращайтесь к администратору парка."
    );
  });

  // Register module handlers
  registerGazeboHandlers(bot);

  // Error handler
  bot.catch((err) => {
    console.error("[Bot] Error:", err);
  });

  // Start
  console.log("[Bot] Starting...");
  await bot.start({
    onStart: () => console.log("[Bot] Running"),
  });
}

// Run bot if executed directly
if (require.main === module) {
  startBot();
}
