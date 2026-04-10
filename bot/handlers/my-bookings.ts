import { Bot, InlineKeyboard } from "grammy";
import type { Context } from "grammy";

import { botFetch, API_URL } from "../lib/api";

type BotContext = Context;

const STATUS_LABELS: Record<string, string> = {
  PENDING: "⏳ Ожидает",
  CONFIRMED: "✅ Подтверждено",
  CANCELLED: "❌ Отменено",
  COMPLETED: "✔️ Завершено",
};

const MODULE_LABELS: Record<string, string> = {
  gazebos: "🏕 Беседка",
  "ps-park": "🎮 PlayStation",
};

/**
 * Register "My Bookings" handler — shows user's active bookings by telegramId.
 */
export function registerMyBookingsHandler(bot: Bot<BotContext>) {
  bot.callbackQuery("menu:my-bookings", loadBookings);
  bot.callbackQuery("mybookings:list", loadBookings);

  bot.command("mybookings", async (ctx) => {
    await showBookings(ctx);
  });

  // Cancel a booking
  bot.callbackQuery(/^mybookings_cancel:(.+)$/, async (ctx) => {
    const bookingId = ctx.match[1];
    await ctx.answerCallbackQuery();

    await ctx.editMessageText(
      "Вы уверены, что хотите отменить это бронирование?",
      {
        reply_markup: new InlineKeyboard()
          .text("✅ Да, отменить", `mybookings_do_cancel:${bookingId}`)
          .text("❌ Нет", "mybookings:list"),
      }
    );
  });

  // Confirm cancellation
  bot.callbackQuery(/^mybookings_do_cancel:(.+)$/, async (ctx) => {
    const bookingId = ctx.match[1];
    await ctx.answerCallbackQuery("Отменяем...");

    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) {
      await ctx.editMessageText("Ошибка авторизации.");
      return;
    }

    try {
      const res = await botFetch("/api/bot/cancel-booking", {
        method: "POST",
        body: JSON.stringify({ telegramId, bookingId }),
      });

      const data = await res.json();

      if (data.success) {
        await ctx.editMessageText(
          "✅ Бронирование отменено.",
          {
            reply_markup: new InlineKeyboard()
              .text("📋 Мои брони", "mybookings:list")
              .text("← Меню", "menu:main"),
          }
        );
      } else {
        await ctx.editMessageText(
          `❌ ${data.error?.message || "Не удалось отменить."}`,
          {
            reply_markup: new InlineKeyboard()
              .text("📋 Назад", "mybookings:list")
              .text("← Меню", "menu:main"),
          }
        );
      }
    } catch {
      await ctx.editMessageText("Ошибка сети. Попробуйте позже.", {
        reply_markup: new InlineKeyboard().text("← Меню", "menu:main"),
      });
    }
  });
}

async function loadBookings(ctx: BotContext) {
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  await showBookings(ctx, true);
}

async function showBookings(ctx: BotContext, edit = false) {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) {
    const text = "Не удалось определить пользователя.";
    if (edit) await ctx.editMessageText(text);
    else await ctx.reply(text);
    return;
  }

  try {
    const res = await botFetch(
      `/api/bot/my-bookings?telegramId=${telegramId}`
    );
    const data = await res.json();

    if (!data.success || data.data.length === 0) {
      const text = "📋 У вас пока нет бронирований.\n\nЗабронируйте беседку или стол PlayStation!";
      const keyboard = new InlineKeyboard()
        .text("🏕 Беседки", "gazebos:list")
        .text("🎮 PlayStation", "pspark:list")
        .row()
        .text("← Главное меню", "menu:main");

      if (edit) await ctx.editMessageText(text, { reply_markup: keyboard });
      else await ctx.reply(text, { reply_markup: keyboard });
      return;
    }

    const bookings = data.data as Array<{
      id: string;
      moduleSlug: string;
      resourceName: string;
      date: string;
      startTime: string;
      endTime: string;
      status: string;
    }>;

    const lines = bookings.map((b) => {
      const moduleLabel = MODULE_LABELS[b.moduleSlug] || b.moduleSlug;
      const status = STATUS_LABELS[b.status] || b.status;
      const date = new Date(b.date).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
      });
      return `${moduleLabel} · ${b.resourceName}\n   📅 ${date} · 🕐 ${b.startTime}–${b.endTime}\n   ${status}`;
    });

    const text = `📋 <b>Ваши бронирования</b>\n\n${lines.join("\n\n")}`;

    // Add cancel buttons for PENDING/CONFIRMED bookings
    const keyboard = new InlineKeyboard();
    const cancellable = bookings.filter(
      (b) => b.status === "PENDING" || b.status === "CONFIRMED"
    );
    for (const b of cancellable) {
      const label = `❌ Отменить: ${b.resourceName}`;
      keyboard.text(label, `mybookings_cancel:${b.id}`).row();
    }
    keyboard.text("🔄 Обновить", "mybookings:list").row();
    keyboard.text("← Главное меню", "menu:main");

    if (edit) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
    else await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  } catch {
    const text = "Ошибка загрузки бронирований. Попробуйте позже.";
    if (edit) await ctx.editMessageText(text);
    else await ctx.reply(text);
  }
}
