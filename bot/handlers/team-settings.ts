import { Bot, InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { prisma } from "@/lib/db";
import { setReleaseNotifyPreference } from "@/modules/notifications/release-notify";

type BotContext = Context;

export interface TeamUser {
  id: string;
  notifyReleases: boolean;
}

export async function getTeamUser(telegramId: string): Promise<TeamUser | null> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: {
      id: true,
      role: true,
      notificationPreference: { select: { notifyReleases: true } },
    },
  });
  if (!user) return null;
  if (user.role !== "SUPERADMIN" && user.role !== "MANAGER") return null;
  return {
    id: user.id,
    notifyReleases: user.notificationPreference?.notifyReleases ?? false,
  };
}

export function settingsKeyboard(notifyReleases: boolean): InlineKeyboard {
  const action = notifyReleases ? "settings:releases:off" : "settings:releases:on";
  const label = notifyReleases ? "🚀 Релизы: ВКЛ ✅" : "🚀 Релизы: ВЫКЛ";
  return new InlineKeyboard().text(label, action);
}

export function settingsText(notifyReleases: boolean): string {
  const state = notifyReleases ? "включены" : "выключены";
  return (
    "<b>Настройки команды</b>\n\n" +
    `🚀 Уведомления о релизах — <b>${state}</b>\n` +
    "После каждого прод-деплоя бот пришлёт сюда сообщение с версией и changelog."
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

    await ctx.reply(settingsText(team.notifyReleases), {
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(team.notifyReleases),
    });
  });

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

    const enable = ctx.match![1] === "on";
    await setReleaseNotifyPreference(team.id, enable);

    await ctx.answerCallbackQuery({
      text: enable ? "✅ Включено" : "⏸ Выключено",
    });
    await ctx.editMessageText(settingsText(enable), {
      parse_mode: "HTML",
      reply_markup: settingsKeyboard(enable),
    });
  });
}
