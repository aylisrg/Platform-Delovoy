import { Bot, InlineKeyboard } from "grammy";
import type { Context } from "grammy";

const API_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

type BotContext = Context;

type MenuItem = {
  id: string;
  name: string;
  description?: string;
  price: number | string;
  category: string;
  isAvailable: boolean;
};

/**
 * Register cafe handlers — menu browsing and order link.
 */
export function registerCafeHandlers(bot: Bot<BotContext>) {
  // Menu entry
  bot.callbackQuery("menu:cafe", loadCategories);
  bot.callbackQuery("cafe:menu", loadCategories);

  bot.command("cafe", async (ctx) => {
    await showCategories(ctx);
  });

  // Category selected → show items
  bot.callbackQuery(/^cafe_cat:(.+)$/, async (ctx) => {
    const category = decodeURIComponent(ctx.match[1]);
    await ctx.answerCallbackQuery();

    try {
      const res = await fetch(`${API_URL}/api/cafe`);
      const data = await res.json();

      if (!data.success) {
        await ctx.editMessageText("Ошибка загрузки меню.", {
          reply_markup: backToCafe(),
        });
        return;
      }

      const items: MenuItem[] = data.data.filter(
        (item: MenuItem) => item.category === category && item.isAvailable
      );

      if (items.length === 0) {
        await ctx.editMessageText(`В категории «${category}» пока нет доступных позиций.`, {
          reply_markup: backToCafe(),
        });
        return;
      }

      const lines = items.map((item) => {
        const price = `${Number(item.price)} ₽`;
        const desc = item.description ? `\n   <i>${item.description}</i>` : "";
        return `• <b>${item.name}</b> — ${price}${desc}`;
      });

      const text =
        `☕ <b>${category}</b>\n\n` +
        lines.join("\n\n") +
        `\n\n💡 Для заказа перейдите на сайт.`;

      const keyboard = new InlineKeyboard()
        .url("🛒 Заказать на сайте", `${API_URL}/cafe`)
        .row()
        .text("← Категории", "cafe:menu")
        .text("← Меню", "menu:main");

      await ctx.editMessageText(text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } catch {
      await ctx.editMessageText("Ошибка загрузки. Попробуйте позже.", {
        reply_markup: backToCafe(),
      });
    }
  });
}

async function loadCategories(ctx: BotContext) {
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
  await showCategories(ctx, true);
}

async function showCategories(ctx: BotContext, edit = false) {
  try {
    const res = await fetch(`${API_URL}/api/cafe`);
    const data = await res.json();

    if (!data.success || data.data.length === 0) {
      const text = "Меню кафе пока недоступно.";
      const opts = { reply_markup: new InlineKeyboard().text("← Меню", "menu:main") };
      if (edit) await ctx.editMessageText(text, opts);
      else await ctx.reply(text, opts);
      return;
    }

    // Extract unique categories
    const categories = [
      ...new Set(data.data.map((item: MenuItem) => item.category)),
    ] as string[];

    const categoryEmoji: Record<string, string> = {
      "Напитки": "🥤",
      "Кофе": "☕",
      "Пицца": "🍕",
      "Основное": "🍽",
      "Завтраки": "🥐",
      "Десерты": "🍰",
      "Салаты": "🥗",
      "Супы": "🍲",
    };

    const keyboard = new InlineKeyboard();
    for (const cat of categories) {
      const emoji = categoryEmoji[cat] || "📌";
      keyboard.text(`${emoji} ${cat}`, `cafe_cat:${encodeURIComponent(cat)}`).row();
    }
    keyboard.url("🛒 Заказать на сайте", `${API_URL}/cafe`).row();
    keyboard.text("← Главное меню", "menu:main");

    const text = "☕ <b>Кафе бизнес-парка «Деловой»</b>\n\nВыберите категорию:";
    const opts = { parse_mode: "HTML" as const, reply_markup: keyboard };

    if (edit) await ctx.editMessageText(text, opts);
    else await ctx.reply(text, opts);
  } catch {
    const text = "Ошибка загрузки меню. Попробуйте позже.";
    if (edit) await ctx.editMessageText(text);
    else await ctx.reply(text);
  }
}

function backToCafe() {
  return new InlineKeyboard()
    .text("← Кафе", "cafe:menu")
    .text("← Меню", "menu:main");
}
