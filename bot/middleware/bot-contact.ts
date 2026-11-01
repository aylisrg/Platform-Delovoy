import type { Context, NextFunction } from "grammy";
import { recordBotBlocked, recordBotContact } from "../../src/modules/telegram-link/bot-contact";

/**
 * «Бот запущен / заблокирован» signals from the bot process
 * (ADR 2026-10-25-team-access-notifications §Q5, AC-E1.2/E1.4/E1.6).
 *
 * - Any message / callback in a PRIVATE chat from a human stamps the contact
 *   (first one = «запущен», later ones lift a block). Groups don't count.
 * - `my_chat_member` kicked → blocked; member → contact again.
 * Message texts are never stored. Writes are throttled per process.
 */
export const BOT_CONTACT_THROTTLE_MS = 10 * 60_000;

type Recorder = {
  contact: (telegramId: string) => Promise<void>;
  blocked: (telegramId: string) => Promise<void>;
};

const defaultRecorder: Recorder = {
  contact: (id) => recordBotContact(id),
  blocked: (id) => recordBotBlocked(id),
};

export function createBotContactTracker(recorder: Recorder = defaultRecorder, now: () => number = Date.now) {
  const lastWrite = new Map<string, number>();

  async function middleware(ctx: Context, next: NextFunction): Promise<void> {
    const from = ctx.from;
    const isPrivate = ctx.chat?.type === "private";
    const isHumanAction = Boolean(ctx.message || ctx.callbackQuery);
    if (from && !from.is_bot && isPrivate && isHumanAction) {
      const id = String(from.id);
      const prev = lastWrite.get(id);
      if (prev === undefined || now() - prev >= BOT_CONTACT_THROTTLE_MS) {
        lastWrite.set(id, now());
        // Fire-and-forget: tracking must never delay or break the handler.
        void recorder.contact(id);
      }
    }
    await next();
  }

  async function onMyChatMember(ctx: Context): Promise<void> {
    const update = ctx.myChatMember;
    if (!update || update.chat.type !== "private") return;
    const id = String(update.from.id);
    const status = update.new_chat_member.status;
    if (status === "kicked") {
      lastWrite.delete(id);
      await recorder.blocked(id);
    } else if (status === "member") {
      lastWrite.set(id, now());
      await recorder.contact(id);
    }
  }

  return { middleware, onMyChatMember };
}
