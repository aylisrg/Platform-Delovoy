/**
 * Deep link handler for Telegram account linking.
 *
 * When a user clicks t.me/DelovoyPark_bot?start=link_{token},
 * this handler processes the token and links their Telegram account.
 */

import { Bot, Context } from "grammy";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/**
 * Handle /start link_{token} deep link.
 * Returns true if handled, false if the deep link is not a link_ type.
 */
export async function handleLinkDeepLink(
  ctx: Context,
  deepLink: string
): Promise<boolean> {
  if (!deepLink.startsWith("link_")) return false;

  const token = deepLink.slice(5); // Remove "link_" prefix
  if (!token || token.length < 20) {
    await ctx.reply(
      "Ссылка для привязки недействительна. Попробуйте создать новую в личном кабинете на сайте.",
    );
    return true;
  }

  const telegramId = String(ctx.from?.id);
  if (!telegramId) {
    await ctx.reply("Не удалось определить ваш Telegram ID.");
    return true;
  }

  try {
    const response = await fetch(`${APP_URL}/api/webapp/link/deep-link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bot-token": BOT_TOKEN || "",
      },
      body: JSON.stringify({
        token,
        telegramId,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        username: ctx.from?.username,
      }),
    });

    const data = await response.json();

    if (data.success) {
      const name = data.data.userName || "пользователь";
      await ctx.reply(
        `Telegram привязан к аккаунту <b>${name}</b> на платформе «Деловой».\n\n` +
          `Теперь вы будете получать уведомления о бронированиях и заказах в этот чат.`,
        { parse_mode: "HTML" }
      );
    } else {
      const errorMsg = data.error?.message || "Неизвестная ошибка";
      await ctx.reply(
        `Не удалось привязать Telegram: ${errorMsg}\n\n` +
          `Попробуйте создать новую ссылку в личном кабинете на сайте.`
      );
    }
  } catch (error) {
    console.error("[Bot Link Handler] Error:", error);
    await ctx.reply(
      "Произошла ошибка при привязке. Попробуйте позже или обратитесь к администратору."
    );
  }

  return true;
}

/**
 * Register the link handler with the bot.
 * This doesn't register a new command — it's called from the /start handler.
 */
export function registerLinkHandler(_bot: Bot): void {
  // The handler is integrated into /start command in bot/index.ts
  // This function exists for consistency with other handler registrations.
}
