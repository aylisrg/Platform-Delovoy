import { Bot } from "grammy";
import { TaskQueue } from "./lib/queue";
import { runClaude, killCurrent } from "./lib/claude-runner";
import { AgentStore } from "./lib/store";

const BOT_TOKEN = process.env.AGENT_TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = Number(process.env.AGENT_TELEGRAM_USER_ID);
const WORKSPACE = process.env.AGENT_WORKSPACE || "/workspace";

if (!BOT_TOKEN) {
  console.error("[Agent] AGENT_TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}
if (!ALLOWED_USER_ID) {
  console.error("[Agent] AGENT_TELEGRAM_USER_ID is required");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);
const queue = new TaskQueue();
const store = new AgentStore(WORKSPACE);

// Whitelist — silently drop everyone except the owner
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_USER_ID) return;
  await next();
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Claude Code Agent готов.\n\n" +
      "Напиши задачу — выполню в рабочем репозитории.\n" +
      "Одна задача за раз; следующие встанут в очередь.\n\n" +
      "/status — состояние очереди\n" +
      "/tasks — последние задачи\n" +
      "/cancel — остановить текущую задачу\n" +
      "/new — сбросить контекст сессии (начать новый чат с Claude)"
  );
});

bot.command("status", async (ctx) => {
  if (queue.busy) {
    const waiting = queue.size;
    await ctx.reply(
      `Выполняется задача.${waiting > 0 ? ` В очереди ещё: ${waiting}.` : ""}`
    );
  } else {
    await ctx.reply("Свободен, жду задачу.");
  }
});

bot.command("tasks", async (ctx) => {
  const tasks = store.listTasks(ctx.chat.id, 10);
  if (tasks.length === 0) {
    await ctx.reply("Задач ещё не было.");
    return;
  }

  const statusEmoji: Record<string, string> = {
    queued: "⏳",
    running: "🔄",
    done: "✅",
    failed: "❌",
  };

  const lines = tasks.map((t) => {
    const emoji = statusEmoji[t.status] ?? "❓";
    const prompt = t.prompt.length > 60 ? t.prompt.slice(0, 57) + "..." : t.prompt;
    const branch = t.branch ? `\n   🌿 ${escapeHtml(t.branch)}` : "";
    return `${emoji} <code>${t.id}</code> ${escapeHtml(prompt)}${branch}`;
  });

  await ctx.reply(`<b>Последние задачи:</b>\n\n${lines.join("\n\n")}`, {
    parse_mode: "HTML",
  });
});

bot.command("cancel", async (ctx) => {
  const killed = killCurrent();
  if (killed) {
    await ctx.reply("Задача остановлена.");
  } else {
    await ctx.reply("Нет активной задачи.");
  }
});

bot.command("new", async (ctx) => {
  store.clearSessionId(ctx.chat.id);
  await ctx.reply(
    "Сессия сброшена. Следующая задача начнёт новый разговор с Claude без предыдущего контекста."
  );
});

bot.on("message:text", async (ctx) => {
  const prompt = ctx.message.text;
  const chatId = ctx.chat.id;

  const task = store.createTask(chatId, prompt);
  const posInQueue = queue.size + (queue.busy ? 1 : 0);

  if (queue.busy) {
    await ctx.reply(
      `Принято (#${posInQueue + 1} в очереди). ID задачи: <code>${task.id}</code>`,
      { parse_mode: "HTML" }
    );
  } else {
    await ctx.reply(
      `Принято. ID задачи: <code>${task.id}</code>`,
      { parse_mode: "HTML" }
    );
  }

  await queue.run(async () => {
    if (posInQueue > 0) {
      await bot.api.sendMessage(chatId, `Задача <code>${task.id}</code> начата.`, {
        parse_mode: "HTML",
      });
    }

    store.updateTask(task.id, {
      status: "running",
      startedAt: new Date().toISOString(),
    });

    const sessionId = store.getSessionId(chatId);
    let progressMsgId: number | undefined;

    try {
      const result = await runClaude(
        prompt,
        async (chunk) => {
          await bot.api.sendMessage(chatId, chunk);
        },
        async () => {
          if (progressMsgId) {
            await bot.api.deleteMessage(chatId, progressMsgId).catch(() => undefined);
          }
          const msg = await bot.api.sendMessage(chatId, "⏳ Ещё работаю...");
          progressMsgId = msg.message_id;
        },
        { sessionId, logPath: store.logPath(task.id) }
      );

      if (result.sessionId) {
        store.setSessionId(chatId, result.sessionId);
        store.updateTask(task.id, { sessionId: result.sessionId });
      }

      store.updateTask(task.id, {
        status: "done",
        finishedAt: new Date().toISOString(),
        exitCode: result.exitCode,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      store.updateTask(task.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      await bot.api
        .sendMessage(
          chatId,
          `Ошибка задачи <code>${task.id}</code>:\n<pre>${escapeHtml(msg)}</pre>`,
          { parse_mode: "HTML" }
        )
        .catch(() => undefined);
    } finally {
      if (progressMsgId) {
        await bot.api.deleteMessage(chatId, progressMsgId).catch(() => undefined);
      }
    }
  });
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

bot.catch((err) => {
  console.error("[Agent] Grammy error:", err);
});

const pendingCount = store.getQueuedTasks().length;
if (pendingCount > 0) {
  console.log(
    `[Agent] ${pendingCount} task(s) left in queued state from last session — use /tasks to review`
  );
}

console.log("[Agent] Starting Claude Code agent bot...");
bot.start({
  onStart: () => console.log("[Agent] Bot is running, waiting for messages"),
});
