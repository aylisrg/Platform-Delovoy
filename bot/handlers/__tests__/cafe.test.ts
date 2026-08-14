import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { registerCafeHandlers } from "../cafe";

type Handler = (ctx: unknown) => Promise<void>;

function collectHandlers() {
  const commands = new Map<string, Handler>();
  const callbacks: Array<{ pattern: RegExp | string; handler: Handler }> = [];
  const fakeBot = {
    command: (name: string, handler: Handler) => commands.set(name, handler),
    callbackQuery: (pattern: RegExp | string, handler: Handler) =>
      callbacks.push({ pattern, handler }),
  };
  registerCafeHandlers(fakeBot as never);
  return { commands, callbacks };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    match: [":cafe_cat:напитки", "напитки"],
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// #534: category/item.name/item.description — админский ввод меню кафе,
// сообщение уходит с parse_mode:"HTML".
describe("cafe_cat callback — экранирование меню (#534)", () => {
  it("экранирует category/name/description перед подстановкой в HTML", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          {
            id: "item-1",
            name: "<b>Пицца</b>",
            description: "<script>alert(1)</script>",
            price: 500,
            category: "<i>Напитки</i>",
            isAvailable: true,
          },
        ],
      })
    );

    const { callbacks } = collectHandlers();
    const handler = callbacks.find((c) => c.pattern.toString().includes("cafe_cat"))!.handler;
    const ctx = makeCtx({ match: [":cafe_cat:<i>Напитки</i>", encodeURIComponent("<i>Напитки</i>")] });

    await handler(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledOnce();
    const [text, opts] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts).toMatchObject({ parse_mode: "HTML" });
    expect(text).toContain("&lt;b&gt;Пицца&lt;/b&gt;");
    expect(text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(text).toContain("&lt;i&gt;Напитки&lt;/i&gt;");
    expect(text).not.toContain("<b>Пицца</b>");
    expect(text).not.toContain("<script>alert(1)</script>");
  });
});
