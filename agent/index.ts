import { Bot } from "grammy";
import { TaskQueue } from "./lib/queue";
import { runClaude } from "./lib/claude-runner";

const BOT_TOKEN = process.env.AGENT_TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = Number(process.env.AGENT_TELEGRAM_USER_ID);

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

// Silently drop messages from anyone except the owner
bot.use(async (ctx, next) => {
  if (ctx.from?.id !== ALLOWED_USER_ID) return;
  await next();
});

bot.command("start", async (ctx) => {
  await ctx.reply(
    "Claude Code Agent готов.\n\n" +
      "Напиши задачу — выполню в рабочем репозитории.\n" +
      "Одна задача за раз; следующие встанут в очередь.\n\n" +
      "/status — состояние очереди"
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

bot.on("message:text", async (ctx) => {
  const task = ctx.message.text;
  const chatId = ctx.chat.id;

  const posInQueue = queue.size + (queue.busy ? 1 : 0);

  if (queue.busy) {
    await ctx.reply(`Принято, в очереди #${posInQueue}. Дождись завершения текущей задачи.`);
  } else {
    await ctx.reply("Принято, выполняю...");
  }

  await queue.run(async () => {
    if (posInQueue > 0) {
      await bot.api.sendMessage(chatId, "Твоя задача начата.");
    }

    let progressMsgId: number | undefined;

    try {
      await runClaude(
        task,
        async (chunk) => {
          await bot.api.sendMessage(chatId, chunk);
        },
        async () => {
          // Delete previous progress ping before sending a new one
          if (progressMsgId) {
            await bot.api.deleteMessage(chatId, progressMsgId).catch(() => undefined);
          }
          const msg = await bot.api.sendMessage(chatId, "⏳ Ещё работаю...");
          progressMsgId = msg.message_id;
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await bot.api
        .sendMessage(chatId, `Ошибка:\n<pre>${escapeHtml(msg)}</pre>`, {
          parse_mode: "HTML",
        })
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

console.log("[Agent] Starting Claude Code agent bot...");
bot.start({
  onStart: () => console.log("[Agent] Bot is running, waiting for messages"),
});
