import { Bot, InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";
import { matchOffice } from "@/modules/tasks/office-matcher";
import { reduce, initialState, type IssueFlowState } from "@/modules/tasks/tg-flow";
import { createTask } from "@/modules/tasks/service";

type BotContext = Context;

const STATE_TTL_SECONDS = 30 * 60;

function stateKey(chatId: number): string {
  return `tasks:issue:${chatId}`;
}

async function loadState(chatId: number): Promise<IssueFlowState> {
  if (!redisAvailable) return initialState();
  try {
    const raw = await redis.get(stateKey(chatId));
    return raw ? (JSON.parse(raw) as IssueFlowState) : initialState();
  } catch {
    return initialState();
  }
}

async function saveState(chatId: number, state: IssueFlowState) {
  if (!redisAvailable) return;
  try {
    if (state.step === "start") {
      await redis.del(stateKey(chatId));
    } else {
      await redis.set(stateKey(chatId), JSON.stringify(state), "EX", STATE_TTL_SECONDS);
    }
  } catch {}
}

async function loadDeps() {
  const [offices, categories] = await Promise.all([
    prisma.office.findMany({
      select: { id: true, number: true, building: true, floor: true },
    }),
    prisma.taskCategory.findMany({
      where: { isActive: true },
      select: { id: true, slug: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  return { offices, categories, matchOffice };
}

async function identifyUser(telegramId: string) {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { id: true, name: true, email: true },
  });
  if (!user) return null;

  const contract = await prisma.rentalContract.findFirst({
    where: {
      status: { in: ["ACTIVE", "EXPIRING"] },
      tenant: {
        OR: [
          { contactName: user.name ?? undefined },
          { email: user.email ?? undefined },
        ],
      },
    },
    include: {
      tenant: { select: { id: true, companyName: true } },
      office: { select: { id: true, number: true } },
    },
    orderBy: { startDate: "desc" },
  });

  if (!contract) return { userId: user.id, tenantId: null, officeId: null, display: user.name ?? "Пользователь" };

  return {
    userId: user.id,
    tenantId: contract.tenant.id,
    officeId: contract.office.id,
    display: `${user.name ?? "Вы"}, ${contract.tenant.companyName}, офис ${contract.office.number}`,
  };
}

function kbFromRows(rows: Array<Array<{ label: string; data: string }>>): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const row of rows) {
    for (const btn of row) {
      kb.text(btn.label, btn.data);
    }
    kb.row();
  }
  return kb;
}

async function emit(
  ctx: BotContext,
  state: IssueFlowState,
  outcome: ReturnType<typeof reduce>["outcome"]
) {
  if (outcome.type === "prompt") {
    const keyboard = outcome.keyboard ? kbFromRows(outcome.keyboard) : undefined;
    await ctx.reply(outcome.message, keyboard ? { reply_markup: keyboard } : undefined);
  } else if (outcome.type === "office_fuzzy") {
    const kb = new InlineKeyboard();
    for (const c of outcome.candidates) {
      kb.text(
        `${c.number}${c.building ? ` · корпус ${c.building}` : ""}`,
        `issue:office:${c.id}`
      ).row();
    }
    kb.text("Ввести заново", "issue:office:retry");
    await ctx.reply(outcome.message, { reply_markup: kb });
  } else if (outcome.type === "error") {
    await ctx.reply(outcome.message);
  } else if (outcome.type === "cancelled") {
    await ctx.reply("Отменено.");
  } else if (outcome.type === "submit") {
    await submitIssue(ctx, outcome.state);
  }
}

async function submitIssue(ctx: BotContext, state: IssueFlowState) {
  try {
    const externalContact: Record<string, string | undefined> = {
      name: state.collectedName,
      telegramHandle: ctx.from?.username,
    };

    const task = await createTask(
      {
        type: "ISSUE",
        source: "TELEGRAM",
        title: `[TG] ${(state.description ?? "жалоба").slice(0, 100)}`,
        description: state.description ?? "",
        priority: state.priority ?? "MEDIUM",
        categoryId: state.categoryId ?? null,
        labels: [],
        reporterUserId: state.identifiedUserId ?? null,
        externalTenantId: state.identifiedTenantId ?? null,
        externalOfficeId: state.collectedOfficeId ?? state.identifiedOfficeId ?? null,
        externalContact,
      },
      {
        id: state.identifiedUserId ?? null,
        source: state.identifiedUserId ? "user" : "system",
      }
    );

    await ctx.reply(
      `Спасибо! Тикет принят в работу.\n\nНомер: ${task.publicId}\nМы напишем как только возьмём задачу в работу.`
    );
  } catch (err) {
    console.error("[issue] submit failed", err);
    await ctx.reply("Упс, что-то пошло не так. Попробуйте ещё раз позже.");
  }
}

export function registerIssueHandlers(bot: Bot<BotContext>) {
  bot.command("issue", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const deps = await loadDeps();
    const identified = ctx.from?.id
      ? await identifyUser(String(ctx.from.id))
      : null;

    const { state, outcome } = reduce(
      initialState(),
      { kind: "start", identified: identified ?? undefined },
      deps
    );
    await saveState(chatId, state);
    await emit(ctx, state, outcome);
  });

  bot.command("cancel", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await saveState(chatId, initialState());
    await ctx.reply("Хорошо, всё сбросил.");
  });

  bot.callbackQuery(/^confirm_identity:(yes|no)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const state = await loadState(chatId);
    const deps = await loadDeps();
    const { state: next, outcome } = reduce(
      state,
      { kind: "confirm_identity", confirmed: ctx.match[1] === "yes" },
      deps
    );
    await saveState(chatId, next);
    await emit(ctx, next, outcome);
  });

  bot.callbackQuery(/^issue:office:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const state = await loadState(chatId);
    const deps = await loadDeps();
    const arg = ctx.match[1];
    const officeId = arg === "retry" ? null : arg;
    const { state: next, outcome } = reduce(
      state,
      { kind: "pick_office", officeId },
      deps
    );
    await saveState(chatId, next);
    await emit(ctx, next, outcome);
  });

  bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const state = await loadState(chatId);
    const deps = await loadDeps();
    const arg = ctx.match[1];
    const categoryId = arg === "skip" ? null : arg;
    const { state: next, outcome } = reduce(
      state,
      { kind: "pick_category", categoryId },
      deps
    );
    await saveState(chatId, next);
    await emit(ctx, next, outcome);
  });

  bot.callbackQuery(/^prio:(LOW|MEDIUM|HIGH|URGENT|skip)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const state = await loadState(chatId);
    const deps = await loadDeps();
    const arg = ctx.match[1];
    const priority =
      arg === "skip" ? null : (arg as "LOW" | "MEDIUM" | "HIGH" | "URGENT");
    const { state: next, outcome } = reduce(
      state,
      { kind: "pick_priority", priority },
      deps
    );
    await saveState(chatId, next);
    await emit(ctx, next, outcome);
  });

  bot.callbackQuery("submit", async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const state = await loadState(chatId);
    const deps = await loadDeps();
    const { state: next, outcome } = reduce(state, { kind: "confirm_submit" }, deps);
    await saveState(chatId, next);
    await emit(ctx, next, outcome);
  });

  bot.callbackQuery("cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await saveState(chatId, initialState());
    await ctx.reply("Отменено.");
  });

  // Free-text messages — only handle when user is inside the issue flow
  bot.on("message:text", async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return next();
    const state = await loadState(chatId);
    if (state.step === "start") return next(); // not in flow

    const text = ctx.message?.text ?? "";
    if (text.startsWith("/")) return next(); // let commands through

    const deps = await loadDeps();
    const { state: nextState, outcome } = reduce(
      state,
      { kind: "text", value: text },
      deps
    );
    await saveState(chatId, nextState);
    await emit(ctx, nextState, outcome);
  });
}
