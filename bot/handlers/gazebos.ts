import { Bot, InlineKeyboard } from "grammy";
import type { Context } from "grammy";

import { botFetch, API_URL } from "../lib/api";

type BotContext = Context;

/**
 * Register gazebo booking handlers on the bot instance.
 */
export function registerGazeboHandlers(bot: Bot<BotContext>) {
  // Menu entry point
  bot.callbackQuery("menu:gazebos", loadGazeboList);
  bot.callbackQuery("gazebos:list", loadGazeboList);

  // /gazebos command
  bot.command("gazebos", async (ctx) => {
    await showGazeboList(ctx);
  });

  // Select gazebo → show dates
  bot.callbackQuery(/^gz_select:(.+)$/, async (ctx) => {
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
      keyboard.text(label, `gz_date:${resourceId}:${dateStr}`).row();
    }
    keyboard.text("← Назад", "gazebos:list");

    await ctx.editMessageText("📅 Выберите дату:", {
      reply_markup: keyboard,
    });
  });

  // Select date → show time slots
  bot.callbackQuery(/^gz_date:(.+):(.+)$/, async (ctx) => {
    const resourceId = ctx.match[1];
    const date = ctx.match[2];
    await ctx.answerCallbackQuery();

    try {
      const res = await fetch(
        `${API_URL}/api/gazebos/availability?date=${date}&resourceId=${resourceId}`
      );
      const data = await res.json();

      if (!data.success || data.data.length === 0) {
        await ctx.editMessageText(
          "Нет данных о доступности. Попробуйте другую дату.",
          { reply_markup: backToGazebos() }
        );
        return;
      }

      const availability = data.data[0];
      const availableSlots = availability.slots.filter(
        (s: { isAvailable: boolean }) => s.isAvailable
      );

      if (availableSlots.length === 0) {
        const dateFormatted = formatDate(date);
        await ctx.editMessageText(
          `На ${dateFormatted} все слоты заняты.`,
          {
            reply_markup: new InlineKeyboard()
              .text("← Другая дата", `gz_select:${resourceId}`)
              .text("← Меню", "menu:main"),
          }
        );
        return;
      }

      const keyboard = new InlineKeyboard();
      for (const slot of availableSlots) {
        keyboard
          .text(
            `${slot.startTime} — ${slot.endTime}`,
            `gz_slot:${resourceId}:${date}:${slot.startTime}:${slot.endTime}`
          )
          .row();
      }
      keyboard.text("← Назад к датам", `gz_select:${resourceId}`);

      await ctx.editMessageText(
        `🕐 <b>${availability.resource.name}</b>\n📅 ${formatDate(date)}\n\nВыберите время:`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
    } catch {
      await ctx.editMessageText("Ошибка загрузки. Попробуйте позже.", {
        reply_markup: backToGazebos(),
      });
    }
  });

  // Confirm slot selection
  bot.callbackQuery(/^gz_slot:(.+):(.+):(.+):(.+)$/, async (ctx) => {
    const resourceId = ctx.match[1];
    const date = ctx.match[2];
    const startTime = ctx.match[3];
    const endTime = ctx.match[4];
    await ctx.answerCallbackQuery();

    await ctx.editMessageText(
      `📋 <b>Подтвердите бронирование</b>\n\n` +
        `📅 ${formatDate(date)}\n` +
        `🕐 ${startTime} — ${endTime}\n\n` +
        `Забронировать?`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("✅ Подтвердить", `gz_book:${resourceId}:${date}:${startTime}:${endTime}`)
          .text("❌ Отмена", "gazebos:list"),
      }
    );
  });

  // Create booking via API
  bot.callbackQuery(/^gz_book:(.+):(.+):(.+):(.+)$/, async (ctx) => {
    const resourceId = ctx.match[1];
    const date = ctx.match[2];
    const startTime = ctx.match[3];
    const endTime = ctx.match[4];
    await ctx.answerCallbackQuery("Создаём бронирование...");

    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) {
      await ctx.editMessageText("Ошибка: не удалось определить пользователя.", {
        reply_markup: backToGazebos(),
      });
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/bot/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramId,
          moduleSlug: "gazebos",
          resourceId,
          date,
          startTime,
          endTime,
          telegramUser: {
            id: ctx.from.id,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            username: ctx.from.username,
          },
        }),
      });

      const data = await res.json();

      if (data.success) {
        await ctx.editMessageText(
          `✅ <b>Бронирование создано!</b>\n\n` +
            `📅 ${formatDate(date)}\n` +
            `🕐 ${startTime} — ${endTime}\n\n` +
            `Статус: ожидает подтверждения.\n` +
            `Мы уведомим вас, когда менеджер подтвердит бронь.`,
          {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard()
              .text("📋 Мои брони", "mybookings:list")
              .text("← Меню", "menu:main"),
          }
        );
      } else {
        const errorMsg = data.error?.message || "Не удалось создать бронирование";
        await ctx.editMessageText(
          `❌ ${errorMsg}`,
          { reply_markup: backToGazebos() }
        );
      }
    } catch {
      await ctx.editMessageText("Ошибка сети. Попробуйте позже.", {
        reply_markup: backToGazebos(),
      });
    }
  });
}

async function loadGazeboList(ctx: BotContext) {
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  await showGazeboList(ctx, true);
}

async function showGazeboList(ctx: BotContext, edit = false) {
  try {
    const res = await fetch(`${API_URL}/api/gazebos`);
    const data = await res.json();

    if (!data.success || data.data.length === 0) {
      const text = "Беседки не найдены. Попробуйте позже.";
      const opts = { reply_markup: new InlineKeyboard().text("← Меню", "menu:main") };
      if (edit) await ctx.editMessageText(text, opts);
      else await ctx.reply(text, opts);
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const resource of data.data) {
      const price = resource.pricePerHour ? `${Number(resource.pricePerHour)}₽/ч` : "";
      const capacity = resource.capacity ? `${resource.capacity} чел` : "";
      const info = [capacity, price].filter(Boolean).join(" · ");
      const label = info ? `${resource.name} (${info})` : resource.name;
      keyboard.text(label, `gz_select:${resource.id}`).row();
    }
    keyboard.text("← Главное меню", "menu:main");

    const text = "🏕 <b>Беседки бизнес-парка «Деловой»</b>\n\nВыберите беседку:";
    const opts = { parse_mode: "HTML" as const, reply_markup: keyboard };

    if (edit) await ctx.editMessageText(text, opts);
    else await ctx.reply(text, opts);
  } catch {
    const text = "Ошибка загрузки беседок. Попробуйте позже.";
    if (edit) await ctx.editMessageText(text);
    else await ctx.reply(text);
  }
}

function backToGazebos() {
  return new InlineKeyboard()
    .text("← Беседки", "gazebos:list")
    .text("← Меню", "menu:main");
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
