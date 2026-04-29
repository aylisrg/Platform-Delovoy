import type { Bot, Context } from "grammy";

import { mainMenuKeyboard } from "./welcome";

type BotContext = Context;

/**
 * Maximum length of user text we persist in SystemEvent metadata.
 * Truncating keeps logs clean and avoids storing arbitrary user content.
 */
const MAX_LOGGED_TEXT_LENGTH = 200;

/**
 * Reply text for unknown input. Lists the main commands so the user can
 * quickly recover from a mistake.
 */
export const UNKNOWN_INPUT_TEXT =
  `Не понимаю эту команду 🤔\n\n` +
  `Вот что я умею:\n` +
  `/gazebos — Барбекю Парк\n` +
  `/ps — Плей Парк\n` +
  `/cafe — Меню кафе\n` +
  `/mybookings — Мои бронирования\n` +
  `/help — Все команды\n\n` +
  `Или воспользуйтесь меню:`;

/**
 * Truncate user text before logging — protects against pathological input
 * and keeps SystemEvent rows reasonably sized.
 */
export function truncateForLog(text: string, max: number = MAX_LOGGED_TEXT_LENGTH): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * Handle any text message that wasn't matched by an earlier command/handler.
 * Replies with a friendly hint + main menu, and logs the event so we can
 * later mine real-world unknown inputs for new commands.
 *
 * `logger` is injected to keep the handler trivially testable without
 * pulling in Prisma in the bot test suite.
 */
export async function handleUnknownText(
  ctx: BotContext,
  logger: (
    level: "INFO",
    source: string,
    message: string,
    metadata?: Record<string, unknown>
  ) => Promise<void> | void
): Promise<void> {
  const text = ctx.message?.text ?? "";
  const telegramId = ctx.from?.id ? String(ctx.from.id) : null;

  await ctx.reply(UNKNOWN_INPUT_TEXT, {
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard(),
  });

  // Fire-and-forget — never let logging failure break the user reply.
  try {
    await logger("INFO", "bot", "unknown_input", {
      telegramId,
      text: truncateForLog(text),
    });
  } catch (err) {
    console.error("[Bot] Failed to log unknown_input:", err);
  }
}

/**
 * Register the catch-all text handler. MUST be called LAST, after every
 * command and domain handler is wired up — otherwise it would swallow
 * legitimate input.
 */
export function registerUnknownTextHandler(
  bot: Bot<BotContext>,
  logger: (
    level: "INFO",
    source: string,
    message: string,
    metadata?: Record<string, unknown>
  ) => Promise<void> | void
): void {
  bot.on("message:text", async (ctx) => {
    await handleUnknownText(ctx, logger);
  });
}
