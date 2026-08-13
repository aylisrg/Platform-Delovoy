import { Bot, InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { prisma } from "@/lib/db";

type BotContext = Context;

export interface TeamUser {
  id: string;
  role: "SUPERADMIN" | "ADMIN" | "MANAGER";
}

/**
 * Любой сотрудник парка (`role !== "USER"`).
 *
 * Раньше проверка была на явный список `SUPERADMIN | MANAGER`, из-за чего
 * ADMIN был «невидимкой» для /settings. Лечим продуктово, а не аллоулистом:
 * состав настроек всё равно определяет Центр уведомлений (ADR §6.4).
 */
export async function getTeamUser(telegramId: string): Promise<TeamUser | null> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { id: true, role: true },
  });
  if (!user) return null;
  if (user.role === "USER") return null;
  return { id: user.id, role: user.role as TeamUser["role"] };
}

function notificationCenterUrl(): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || "https://delovoy-park.ru"
  ).replace(/\/$/, "");
  return `${base}/webapp/notifications`;
}

/** Кнопка-переход в Центр уведомлений Mini App. */
export function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard().webApp(
    "🔔 Центр уведомлений",
    notificationCenterUrl(),
  );
}

export function settingsText(): string {
  return (
    "<b>Настройки уведомлений переехали в Центр уведомлений</b>\n\n" +
    "Теперь тумблеры по каждому типу событий — в мини-приложении: " +
    "релизы, брони, заказы кафе и остальное в одном месте.\n\n" +
    "Открой Центр уведомлений кнопкой ниже."
  );
}

export function registerTeamSettingsHandlers(bot: Bot<BotContext>) {
  bot.command("settings", async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) return;

    const team = await getTeamUser(tgId);
    if (!team) {
      await ctx.reply(
        "Эти настройки доступны только команде парка. " +
          "Если вы менеджер — сначала свяжите аккаунт через мини-приложение.",
      );
      return;
    }

    await ctx.reply(settingsText(), {
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(),
    });
  });

  // Легаси-клавиатуры висят в старых чатах. Обработчик остаётся, но ничего
  // не пишет: подписка настраивается только в Центре (AC-6.4). Молчаливая
  // кнопка хуже, чем перенаправление.
  bot.callbackQuery(/^settings:releases:(on|off)$/, async (ctx) => {
    const tgId = ctx.from?.id?.toString();
    if (!tgId) {
      await ctx.answerCallbackQuery({ text: "Нет доступа", show_alert: true });
      return;
    }

    const team = await getTeamUser(tgId);
    if (!team) {
      await ctx.answerCallbackQuery({
        text: "Только для команды парка",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Настройка переехала" });
    await ctx.editMessageText(settingsText(), {
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(),
    });
  });
}
