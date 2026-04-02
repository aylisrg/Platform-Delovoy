import { Bot, InlineKeyboard } from "grammy";
import type { Context } from "grammy";

const API_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

type BotContext = Context;

/**
 * Register gazebo booking handlers on the bot instance.
 */
export function registerGazeboHandlers(bot: Bot<BotContext>) {
  // /gazebos — show available gazebos
  bot.command("gazebos", async (ctx) => {
    try {
      const res = await fetch(`${API_URL}/api/gazebos`);
      const data = await res.json();

      if (!data.success || data.data.length === 0) {
        await ctx.reply("Беседки не найдены. Попробуйте позже.");
        return;
      }

      const keyboard = new InlineKeyboard();
      for (const resource of data.data) {
        const price = resource.pricePerHour
          ? `${Number(resource.pricePerHour)} ₽/час`
          : "";
        const capacity = resource.capacity ? `до ${resource.capacity} чел.` : "";
        const label = `${resource.name} ${capacity} ${price}`.trim();
        keyboard.text(label, `gazebo_select:${resource.id}`).row();
      }

      await ctx.reply(
        "🏕 *Беседки бизнес\\-парка Деловой*\n\nВыберите беседку для бронирования:",
        {
          parse_mode: "MarkdownV2",
          reply_markup: keyboard,
        }
      );
    } catch {
      await ctx.reply("Ошибка загрузки беседок. Попробуйте позже.");
    }
  });

  // Callback: select gazebo → show date options
  bot.callbackQuery(/^gazebo_select:(.+)$/, async (ctx) => {
    const resourceId = ctx.match[1];
    await ctx.answerCallbackQuery();

    const today = new Date();
    const keyboard = new InlineKeyboard();

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0];
      const label = date.toLocaleDateString("ru-RU", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      keyboard.text(label, `gazebo_date:${resourceId}:${dateStr}`).row();
    }

    await ctx.editMessageText("📅 Выберите дату:", { reply_markup: keyboard });
  });

  // Callback: select date → show available slots
  bot.callbackQuery(/^gazebo_date:(.+):(.+)$/, async (ctx) => {
    const resourceId = ctx.match[1];
    const date = ctx.match[2];
    await ctx.answerCallbackQuery();

    try {
      const res = await fetch(
        `${API_URL}/api/gazebos/availability?date=${date}&resourceId=${resourceId}`
      );
      const data = await res.json();

      if (!data.success || data.data.length === 0) {
        await ctx.editMessageText("Нет данных о доступности.");
        return;
      }

      const availability = data.data[0];
      const availableSlots = availability.slots.filter(
        (s: { isAvailable: boolean }) => s.isAvailable
      );

      if (availableSlots.length === 0) {
        await ctx.editMessageText(`На ${date} все слоты заняты. Выберите другую дату.`);
        return;
      }

      const keyboard = new InlineKeyboard();
      for (const slot of availableSlots) {
        keyboard
          .text(
            `${slot.startTime} — ${slot.endTime}`,
            `gazebo_book:${resourceId}:${date}:${slot.startTime}:${slot.endTime}`
          )
          .row();
      }
      keyboard.text("← Назад к датам", `gazebo_select:${resourceId}`);

      const dateFormatted = new Date(date).toLocaleDateString("ru-RU", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });

      await ctx.editMessageText(
        `🕐 Доступное время на ${dateFormatted}:\n\n${availability.resource.name}`,
        { reply_markup: keyboard }
      );
    } catch {
      await ctx.editMessageText("Ошибка загрузки слотов. Попробуйте позже.");
    }
  });

  // Callback: book a slot
  bot.callbackQuery(/^gazebo_book:(.+):(.+):(.+):(.+)$/, async (ctx) => {
    const resourceId = ctx.match[1];
    const date = ctx.match[2];
    const startTime = ctx.match[3];
    const endTime = ctx.match[4];
    await ctx.answerCallbackQuery();

    const keyboard = new InlineKeyboard()
      .text("✅ Подтвердить", `gazebo_confirm:${resourceId}:${date}:${startTime}:${endTime}`)
      .text("❌ Отмена", `gazebo_cancel_flow`);

    const dateFormatted = new Date(date).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    });

    await ctx.editMessageText(
      `📋 Подтвердите бронирование:\n\n📅 ${dateFormatted}\n🕐 ${startTime} — ${endTime}\n\nЗабронировать?`,
      { reply_markup: keyboard }
    );
  });

  // Callback: confirm booking
  bot.callbackQuery(/^gazebo_confirm:(.+):(.+):(.+):(.+)$/, async (ctx) => {
    const resourceId = ctx.match[1];
    const date = ctx.match[2];
    const startTime = ctx.match[3];
    const endTime = ctx.match[4];
    await ctx.answerCallbackQuery();

    // Note: In production, the bot needs to authenticate the user.
    // For now, we show a link to the web app for booking.
    const bookUrl = `${API_URL}/gazebos?book=${resourceId}&date=${date}&start=${startTime}&end=${endTime}`;

    await ctx.editMessageText(
      `🔗 Для завершения бронирования перейдите на сайт:\n\n${bookUrl}\n\n` +
        `(Авторизация через Telegram будет добавлена в следующем обновлении)`,
      { link_preview_options: { is_disabled: true } }
    );
  });

  // Callback: cancel booking flow
  bot.callbackQuery("gazebo_cancel_flow", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("Бронирование отменено. Используйте /gazebos для нового выбора.");
  });
}
