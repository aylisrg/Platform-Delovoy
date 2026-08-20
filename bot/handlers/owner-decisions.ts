import { Bot, InlineKeyboard } from "grammy";
import type { Context } from "grammy";

import { botFetch } from "../lib/api";
import { escapeHtml } from "@/lib/telegram/escape";

type BotContext = Context;

/**
 * Решения владельца по автоочереди — кнопки в личном чате (контур
 * owner-decisions, ADR 2026-08-20-owner-out-of-github).
 *
 * Бот здесь — только устройство ввода: нажатие уходит в
 * POST /api/bot/owner-decisions (verifyBotRequest + серверная сверка
 * владельца), решение хранится в БД платформы, а в GitHub его исполняет
 * свипер очереди. Никаких GitHub-кредов у бота нет и не появится.
 *
 * Авторизация: ТОЛЬКО владелец. `TELEGRAM_OWNER_CHAT_ID` — личный чат, в нём
 * chat id совпадает с user id; сравниваем строки (env — строка, ctx.from.id —
 * число; строгое равенство без приведения молча заблокировало бы владельца).
 */
export function registerOwnerDecisionsHandlers(bot: Bot<BotContext>) {
  const isOwner = (ctx: Context): boolean =>
    !!ctx.from && String(ctx.from.id) === (process.env.TELEGRAM_OWNER_CHAT_ID ?? "");

  // Двухшаговый confirm для необратимого (мерж) и почти необратимого (reject):
  // первый тап меняет клавиатуру на подтверждение, второй — исполняет.
  bot.callbackQuery(/^ownerdec:([A-Za-z0-9]+):(approve|reject)$/, async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.answerCallbackQuery({ text: "Недоступно", show_alert: false });
      return;
    }
    const [, id, action] = ctx.match;
    await ctx.answerCallbackQuery();
    const label = action === "approve" ? "✅ Да, подтверждаю" : "❌ Да, отклонить";
    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard()
        .text(label, `ownerdec:${id}:confirm-${action}`)
        .text("↩️ Назад", `ownerdec:${id}:restore`),
    });
  });

  bot.callbackQuery(/^ownerdec:([A-Za-z0-9]+):restore$/, async (ctx) => {
    if (!isOwner(ctx)) {
      await ctx.answerCallbackQuery({ text: "Недоступно", show_alert: false });
      return;
    }
    const [, id] = ctx.match;
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: decisionKeyboard(id) });
  });

  bot.callbackQuery(
    /^ownerdec:([A-Za-z0-9]+):(confirm-approve|confirm-reject|defer|cancel)$/,
    async (ctx) => {
      if (!isOwner(ctx)) {
        await ctx.answerCallbackQuery({ text: "Недоступно", show_alert: false });
        return;
      }
      const [, id, raw] = ctx.match;
      const action = raw === "confirm-approve" ? "approve" : raw === "confirm-reject" ? "reject" : raw;
      const res = await decideApi(ctx, { op: "decide", decisionId: id, action });
      if (!res.ok) {
        await ctx.answerCallbackQuery({ text: res.error, show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery({ text: res.ack ?? "Записано" });
      // Решённое сообщение теряет кнопки — двойной тап по старой кнопке не
      // должен ничего исполнять повторно (сервер и так откажет, но зачем шум).
      if (action === "approve" || action === "reject") {
        try {
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
        } catch {
          // сообщение могло быть уже отредактировано — не критично
        }
      }
    },
  );

  // Список ждущих решений — восстановление после потерянного сообщения.
  bot.command("decisions", async (ctx) => {
    if (!isOwner(ctx)) return;
    const list = await listApi(ctx);
    if (!list) return;
    if (list.length === 0) {
      await ctx.reply("Решений, ждущих тебя, нет. 🎉");
      return;
    }
    for (const d of list) {
      const age = Math.round((Date.now() - new Date(d.createdAt).getTime()) / 3.6e6);
      await ctx.reply(
        `${d.status === "DEFERRED" ? "⏸" : "❓"} <b>${escapeHtml(d.title)}</b>\n` +
          `${d.subjectNumber ? `#${d.subjectNumber} · ` : ""}${escapeHtml(d.kind)} · ждёт ${age} ч`,
        { parse_mode: "HTML", reply_markup: decisionKeyboard(d.id) },
      );
    }
  });

  // «идея: …» — поручение владельца; реплай на сообщение решения — детали ответа.
  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const text = ctx.message.text.trim();

    const ideaMatch = /^(?:идея|idea)\s*[::]\s*(.+)$/isu.exec(text);
    if (ideaMatch) {
      const res = await rawApi(ctx, { op: "idea", text: ideaMatch[1].trim() });
      if (res?.success) {
        const created = (res.data as { created: boolean }).created;
        await ctx.reply(
          created
            ? "💡 Принял. Заведу задачу — приоритет назначит ближайший триаж, ход дела увидишь в вечернем дайджесте."
            : "💡 Такая идея уже в работе — дубль не завожу.",
        );
      } else {
        await ctx.reply("Не смог записать идею — попробуй ещё раз чуть позже.");
      }
      return;
    }

    const replyTo = ctx.message.reply_to_message;
    if (replyTo) {
      const res = await rawApi(ctx, {
        op: "note",
        telegramMessageId: String(replyTo.message_id),
        text,
      });
      if (res?.success) {
        await ctx.reply("📝 Добавил к решению — исполнитель увидит.");
        return;
      }
      // Реплай не на сообщение решения — пусть разбирает следующий хендлер.
    }
    return next();
  });
}

/** Универсальная клавиатура решения (для /decisions и «Назад»). */
function decisionKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Да", `ownerdec:${id}:approve`)
    .text("❌ Нет", `ownerdec:${id}:reject`)
    .row()
    .text("⏸ Позже", `ownerdec:${id}:defer`);
}

interface DecisionListItem {
  id: string;
  title: string;
  kind: string;
  status: string;
  subjectNumber: number | null;
  createdAt: string;
}

async function rawApi(
  ctx: Context,
  body: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: { message?: string } } | null> {
  try {
    const res = await botFetch("/api/bot/owner-decisions", {
      method: "POST",
      body: JSON.stringify({ ...body, telegramUserId: String(ctx.from?.id ?? "") }),
    });
    return (await res.json()) as { success: boolean; data?: unknown; error?: { message?: string } };
  } catch (err) {
    console.error("[owner-decisions bot] API error:", err);
    return null;
  }
}

async function decideApi(
  ctx: Context,
  body: { op: "decide"; decisionId: string; action: string },
): Promise<{ ok: boolean; ack?: string; error: string }> {
  const res = await rawApi(ctx, body);
  if (!res) return { ok: false, error: "Сайт недоступен — попробуй позже" };
  if (!res.success) return { ok: false, error: res.error?.message ?? "Не получилось" };
  const data = res.data as { ack?: string };
  return { ok: true, ack: data.ack, error: "" };
}

async function listApi(ctx: Context): Promise<DecisionListItem[] | null> {
  const res = await rawApi(ctx, { op: "list" });
  if (!res?.success) {
    await ctx.reply("Не смог получить список решений — сайт недоступен.");
    return null;
  }
  return res.data as DecisionListItem[];
}
