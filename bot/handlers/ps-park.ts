import { Bot, InlineKeyboard } from "grammy";
import type { Context } from "grammy";

import { botFetch, API_URL } from "../lib/api";

type BotContext = Context;

/**
 * Register Плей Парк booking handlers.
 */
export function registerPSParkHandlers(bot: Bot<BotContext>) {
  // Menu entry + command
  bot.callbackQuery("menu:ps-park", loadPSList);
  bot.callbackQuery("pspark:list", loadPSList);

  bot.command("ps", async (ctx) => {
    await showPSList(ctx);
  });

  // Select table → show dates
  bot.callbackQuery(/^ps_select:(.+)$/, async (ctx) => {
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
      keyboard.text(label, `ps_date:${resourceId}:${dateStr}`).row();
    }
    keyboard.text("← Назад", "pspark:list");

    await ctx.editMessageText("📅 Выберите дату:", { reply_markup: keyboard });
  });

  // Select date → show time slots
  bot.callbackQuery(/^ps_date:(.+):(.+)$/, async (ctx) => {
    const resourceId = ctx.match[1];
    const date = ctx.match[2];
    await ctx.answerCallbackQuery();

    try {
      const res = await fetch(
        `${API_URL}/api/ps-park/availability?date=${date}&resourceId=${resourceId}`
      );
      const data = await res.json();

      if (!data.success || data.data.length === 0) {
        await ctx.editMessageText(
          "Нет данных о доступности. Попробуйте другую дату.",
          { reply_markup: backToPS() }
        );
        return;
      }

      const availability = data.data[0];
      const availableSlots = availability.slots.filter(
        (s: { isAvailable: boolean }) => s.isAvailable
      );

      if (availableSlots.length === 0) {
        await ctx.editMessageText(
          `На ${formatDate(date)} все слоты заняты.`,
          {
            reply_markup: new InlineKeyboard()
              .text("← Другая дата", `ps_select:${resourceId}`)
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
            `ps_slot:${resourceId}:${date}:${slot.startTime}:${slot.endTime}`
          )
          .row();
      }
      keyboard.text("← Назад к датам", `ps_select:${resourceId}`);

      await ctx.editMessageText(
        `🕐 <b>${availability.resource.name}</b>\n📅 ${formatDate(date)}\n\nВыберите время:`,
        { parse_mode: "HTML", reply_markup: keyboard }
      );
    } catch {
      await ctx.editMessageText("Ошибка загрузки. Попробуйте позже.", {
        reply_markup: backToPS(),
      });
    }
  });

  // Confirm slot
  bot.callbackQuery(/^ps_slot:(.+):(.+):(.+):(.+)$/, async (ctx) => {
    const resourceId = ctx.match[1];
    const date = ctx.match[2];
    const startTime = ctx.match[3];
    const endTime = ctx.match[4];
    await ctx.answerCallbackQuery();

    await ctx.editMessageText(
      `📋 <b>Подтвердите бронирование</b>\n\n` +
        `🎮 Плей Парк\n` +
        `📅 ${formatDate(date)}\n` +
        `🕐 ${startTime} — ${endTime}\n\n` +
        `Забронировать?`,
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text("✅ Подтвердить", `ps_book:${resourceId}:${date}:${startTime}:${endTime}`)
          .text("❌ Отмена", "pspark:list"),
      }
    );
  });

  // Create booking
  bot.callbackQuery(/^ps_book:(.+):(.+):(.+):(.+)$/, async (ctx) => {
    const resourceId = ctx.match[1];
    const date = ctx.match[2];
    const startTime = ctx.match[3];
    const endTime = ctx.match[4];
    await ctx.answerCallbackQuery("Создаём бронирование...");

    const telegramId = ctx.from?.id?.toString();
    if (!telegramId) {
      await ctx.editMessageText("Ошибка: не удалось определить пользователя.", {
        reply_markup: backToPS(),
      });
      return;
    }

    try {
      const res = await botFetch("/api/bot/book", {
        method: "POST",
        body: JSON.stringify({
          telegramId,
          moduleSlug: "ps-park",
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
            `🎮 Плей Парк\n` +
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
        await ctx.editMessageText(`❌ ${errorMsg}`, { reply_markup: backToPS() });
      }
    } catch {
      await ctx.editMessageText("Ошибка сети. Попробуйте позже.", {
        reply_markup: backToPS(),
      });
    }
  });
}

async function loadPSList(ctx: BotContext) {
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  await showPSList(ctx, true);
}

async function showPSList(ctx: BotContext, edit = false) {
  try {
    const res = await fetch(`${API_URL}/api/ps-park`);
    const data = await res.json();

    if (!data.success || data.data.length === 0) {
      const text = "Столы PlayStation не найдены. Попробуйте позже.";
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
      keyboard.text(label, `ps_select:${resource.id}`).row();
    }
    keyboard.text("← Главное меню", "menu:main");

    const text = "🎮 <b>Плей Парк</b>\n\nВыберите стол:";
    const opts = { parse_mode: "HTML" as const, reply_markup: keyboard };

    if (edit) await ctx.editMessageText(text, opts);
    else await ctx.reply(text, opts);
  } catch {
    const text = "Ошибка загрузки столов. Попробуйте позже.";
    if (edit) await ctx.editMessageText(text);
    else await ctx.reply(text);
  }
}

function backToPS() {
  return new InlineKeyboard()
    .text("← Плей Парк", "pspark:list")
    .text("← Меню", "menu:main");
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
