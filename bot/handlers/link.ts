/**
 * Deep link handler for Telegram account linking.
 *
 * When a user clicks t.me/DelovoyPark_bot?start=link_{token}, the bot first
 * shows whose account the link belongs to and links only after «Привязать»:
 * a Start on someone else's link must never silently attach this Telegram
 * (and fold its bot-created account) into theirs (ADR 2026-10-25 §Q9).
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import { escapeHtml } from "@/lib/telegram/escape";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/** `link_ok:<48 hex>` — 56 bytes, inside Telegram's 64-byte callback_data limit. */
export const LINK_CONFIRM_PREFIX = "link_ok:";
export const LINK_CANCEL = "link_cancel";

const INVALID_LINK =
  "Ссылка для привязки недействительна. Попробуйте создать новую в личном кабинете на сайте.";

type ApiEnvelope<T> = { success: true; data: T } | { success: false; error?: { code?: string; message?: string } };

async function callDeepLinkApi<T>(ctx: Context, token: string, preview: boolean): Promise<ApiEnvelope<T>> {
  const response = await fetch(`${APP_URL}/api/webapp/link/deep-link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bot-token": BOT_TOKEN || "",
    },
    body: JSON.stringify({
      token,
      telegramId: String(ctx.from?.id),
      firstName: ctx.from?.first_name,
      lastName: ctx.from?.last_name,
      username: ctx.from?.username,
      ...(preview ? { preview: true } : {}),
    }),
  });
  return (await response.json()) as ApiEnvelope<T>;
}

function validToken(token: string): boolean {
  return token.length >= 20 && token.length <= 100 && /^[A-Za-z0-9]+$/.test(token);
}

/**
 * Handle /start link_{token} deep link: ask for confirmation.
 * Returns true if handled, false if the deep link is not a link_ type.
 */
export async function handleLinkDeepLink(
  ctx: Context,
  deepLink: string
): Promise<boolean> {
  if (!deepLink.startsWith("link_")) return false;

  const token = deepLink.slice(5); // Remove "link_" prefix
  if (!validToken(token)) {
    await ctx.reply(INVALID_LINK);
    return true;
  }
  if (!ctx.from?.id) {
    await ctx.reply("Не удалось определить ваш Telegram ID.");
    return true;
  }

  try {
    const data = await callDeepLinkApi<{ userName: string | null; emailMasked: string | null }>(ctx, token, true);
    if (!data.success) {
      await ctx.reply(data.error?.message || INVALID_LINK);
      return true;
    }
    // #534: userName — User.name, не ограничено на входе.
    const name = escapeHtml(data.data.userName || "без имени");
    const email = data.data.emailMasked ? ` (${escapeHtml(data.data.emailMasked)})` : "";
    await ctx.reply(
      `Привязать этот Telegram к аккаунту <b>${name}</b>${email} на платформе «Деловой»?\n\n` +
        `Если ссылку создавали не вы — нажмите «Отмена».`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("Привязать", `${LINK_CONFIRM_PREFIX}${token}`)
          .text("Отмена", LINK_CANCEL),
      }
    );
  } catch (error) {
    console.error("[Bot Link Handler] Preview error:", error);
    await ctx.reply(
      "Произошла ошибка при привязке. Попробуйте позже или обратитесь к администратору."
    );
  }

  return true;
}

/** «Привязать» pressed: the real link call. */
export async function confirmLink(ctx: Context, token: string): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => undefined);
  await ctx.editMessageReplyMarkup().catch(() => undefined);
  if (!validToken(token) || !ctx.from?.id) {
    await ctx.reply(INVALID_LINK);
    return;
  }

  try {
    const data = await callDeepLinkApi<{ userName: string | null; merged?: boolean }>(ctx, token, false);

    if (data.success) {
      // #534: userName — User.name, не ограничено на входе.
      const name = escapeHtml(data.data.userName || "пользователь");
      // ADR 2026-10-25 §Q9: the bot-created account of this Telegram was
      // folded into the site account — say so, history now lives in one place.
      const mergedNote = data.data.merged === true
        ? `Аккаунт, созданный ботом, объединён с ним — брони, заказы и настройки теперь в одном аккаунте.\n\n`
        : "";
      await ctx.reply(
        `Telegram привязан к аккаунту <b>${name}</b> на платформе «Деловой».\n\n` +
          mergedNote +
          `Теперь вы будете получать уведомления о бронированиях и заказах в этот чат.`,
        { parse_mode: "HTML" }
      );
    } else if (data.error?.code === "TELEGRAM_IN_USE_MERGE_REQUESTED") {
      // AC-E4.1: not a dead end — the request is with the administrator.
      await ctx.reply(String(data.error.message));
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
}

/** «Отмена» pressed: nothing is linked, the token stays unused until it expires. */
export async function cancelLink(ctx: Context): Promise<void> {
  await ctx.answerCallbackQuery().catch(() => undefined);
  await ctx.editMessageText("Привязка отменена. Telegram не привязан.").catch(() => undefined);
}

/** The /start part is wired in bot/index.ts; this registers the confirm buttons. */
export function registerLinkHandler(bot: Bot): void {
  bot.callbackQuery(new RegExp(`^${LINK_CONFIRM_PREFIX}(.+)$`), (ctx) => confirmLink(ctx, ctx.match?.[1] ?? ""));
  bot.callbackQuery(LINK_CANCEL, (ctx) => cancelLink(ctx));
}
