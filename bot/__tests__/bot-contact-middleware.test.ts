import { describe, it, expect, vi } from "vitest";
import type { Context } from "grammy";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOT_CONTACT_THROTTLE_MS, createBotContactTracker } from "../middleware/bot-contact";

function ctxFor(partial: Record<string, unknown>): Context {
  return partial as unknown as Context;
}

function setup() {
  let clock = 1_000_000;
  const recorder = { contact: vi.fn().mockResolvedValue(undefined), blocked: vi.fn().mockResolvedValue(undefined) };
  const tracker = createBotContactTracker(recorder, () => clock);
  return { recorder, tracker, advance: (ms: number) => (clock += ms) };
}

const privateMsg = { from: { id: 42, is_bot: false }, chat: { type: "private" }, message: { text: "/start" } };

describe("bot contact middleware (AC-E1.2, AC-E1.6)", () => {
  it("records a private-chat message and always continues the chain", async () => {
    const { recorder, tracker } = setup();
    const next = vi.fn();
    await tracker.middleware(ctxFor(privateMsg), next);
    expect(recorder.contact).toHaveBeenCalledWith("42");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("ignores groups, bots and non-message updates", async () => {
    const { recorder, tracker } = setup();
    const next = vi.fn();
    await tracker.middleware(ctxFor({ ...privateMsg, chat: { type: "group" } }), next);
    await tracker.middleware(ctxFor({ ...privateMsg, from: { id: 7, is_bot: true } }), next);
    await tracker.middleware(ctxFor({ from: { id: 42, is_bot: false }, chat: { type: "private" } }), next);
    expect(recorder.contact).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(3);
  });

  it("throttles writes per user for 10 minutes", async () => {
    const { recorder, tracker, advance } = setup();
    await tracker.middleware(ctxFor(privateMsg), vi.fn());
    await tracker.middleware(ctxFor(privateMsg), vi.fn());
    expect(recorder.contact).toHaveBeenCalledTimes(1);
    advance(BOT_CONTACT_THROTTLE_MS);
    await tracker.middleware(ctxFor(privateMsg), vi.fn());
    expect(recorder.contact).toHaveBeenCalledTimes(2);
  });
});

describe("my_chat_member (AC-E1.4)", () => {
  const update = (status: string, chatType = "private") => ({
    myChatMember: { chat: { type: chatType }, from: { id: 42 }, new_chat_member: { status } },
  });

  it("kicked → blocked; member → contact (unblock); groups ignored", async () => {
    const { recorder, tracker } = setup();
    await tracker.onMyChatMember(ctxFor(update("kicked")));
    expect(recorder.blocked).toHaveBeenCalledWith("42");
    await tracker.onMyChatMember(ctxFor(update("member")));
    expect(recorder.contact).toHaveBeenCalledWith("42");
    await tracker.onMyChatMember(ctxFor(update("kicked", "supergroup")));
    expect(recorder.blocked).toHaveBeenCalledTimes(1);
  });
});

describe("bot/index.ts wiring", () => {
  const src = readFileSync(resolve(__dirname, "..", "index.ts"), "utf-8");

  it("registers the tracker before the first command and listens to my_chat_member", () => {
    expect(src.indexOf("bot.use(botContact.middleware)")).toBeGreaterThan(-1);
    expect(src.indexOf("bot.use(botContact.middleware)")).toBeLessThan(src.indexOf('bot.command("start"'));
    expect(src).toMatch(/bot\.on\("my_chat_member", botContact\.onMyChatMember\)/);
  });

  it("allowed_updates is explicit and covers every consumed update type", () => {
    const list = src.match(/BOT_ALLOWED_UPDATES = \[([^\]]+)\]/)?.[1] ?? "";
    for (const type of ["message", "callback_query", "my_chat_member"]) {
      expect(list).toContain(`"${type}"`);
    }
    expect(src).toMatch(/allowed_updates: BOT_ALLOWED_UPDATES/);
  });
});
