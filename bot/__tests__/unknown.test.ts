import { describe, it, expect, vi } from "vitest";

import {
  handleUnknownText,
  truncateForLog,
  UNKNOWN_INPUT_TEXT,
} from "../handlers/unknown";

type FakeCtx = {
  message?: { text?: string };
  from?: { id?: number; first_name?: string };
  reply: ReturnType<typeof vi.fn>;
};

function makeCtx(overrides: Partial<FakeCtx> = {}): FakeCtx {
  return {
    message: { text: "хочу беседку на субботу" },
    from: { id: 12345, first_name: "Илья" },
    reply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("truncateForLog", () => {
  it("returns the text unchanged when shorter than the limit", () => {
    expect(truncateForLog("hello", 10)).toBe("hello");
  });

  it("truncates and appends an ellipsis when over the limit", () => {
    const result = truncateForLog("a".repeat(50), 10);
    expect(result).toHaveLength(11); // 10 chars + ellipsis
    expect(result.endsWith("…")).toBe(true);
  });

  it("uses 200 chars as the default cap", () => {
    const result = truncateForLog("x".repeat(500));
    expect(result.length).toBe(201);
  });
});

describe("handleUnknownText", () => {
  it("replies with the unknown-input hint text and a keyboard", async () => {
    const ctx = makeCtx();
    const logger = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleUnknownText(ctx as any, logger);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, opts] = ctx.reply.mock.calls[0];
    expect(text).toBe(UNKNOWN_INPUT_TEXT);
    expect(text).toContain("Не понимаю");
    expect(text).toContain("/gazebos");
    expect(text).toContain("/ps");
    expect(text).toContain("/cafe");
    expect(text).toContain("/mybookings");
    expect(text).toContain("/help");
    expect(opts.reply_markup).toBeDefined();
  });

  it("logs the unknown input as INFO with truncated text + telegramId", async () => {
    const ctx = makeCtx({ message: { text: "y".repeat(500) } });
    const logger = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleUnknownText(ctx as any, logger);

    expect(logger).toHaveBeenCalledTimes(1);
    const [level, source, message, metadata] = logger.mock.calls[0];
    expect(level).toBe("INFO");
    expect(source).toBe("bot");
    expect(message).toBe("unknown_input");
    expect(metadata.telegramId).toBe("12345");
    expect(metadata.text.length).toBeLessThanOrEqual(201);
  });

  it("still replies to the user when the logger throws", async () => {
    const ctx = makeCtx();
    const logger = vi.fn().mockRejectedValue(new Error("DB down"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(handleUnknownText(ctx as any, logger)).resolves.toBeUndefined();
    expect(ctx.reply).toHaveBeenCalledTimes(1);
  });

  it("handles missing ctx.from / ctx.message gracefully", async () => {
    const ctx = makeCtx({ from: undefined, message: undefined });
    const logger = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleUnknownText(ctx as any, logger);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const metadata = logger.mock.calls[0][3];
    expect(metadata.telegramId).toBeNull();
    expect(metadata.text).toBe("");
  });
});
