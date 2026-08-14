import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { registerPSParkHandlers } from "../ps-park";

type Handler = (ctx: unknown) => Promise<void>;

function collectHandlers() {
  const commands = new Map<string, Handler>();
  const callbacks: Array<{ pattern: RegExp | string; handler: Handler }> = [];
  const fakeBot = {
    command: (name: string, handler: Handler) => commands.set(name, handler),
    callbackQuery: (pattern: RegExp | string, handler: Handler) =>
      callbacks.push({ pattern, handler }),
  };
  registerPSParkHandlers(fakeBot as never);
  return { commands, callbacks };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
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

// #534: availability.resource.name — админский ввод (название стола),
// сообщение уходит с parse_mode:"HTML".
describe("ps_date callback — экранирование resource.name (#534)", () => {
  it("экранирует resource.name перед подстановкой в HTML-сообщение", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        data: [
          {
            resource: { name: "<b>Стол 1</b><script>alert(1)</script>" },
            slots: [{ startTime: "10:00", endTime: "12:00", isAvailable: true }],
          },
        ],
      })
    );

    const { callbacks } = collectHandlers();
    const handler = callbacks.find((c) => c.pattern.toString().includes("ps_date"))!.handler;
    const ctx = makeCtx({ match: [":ps_date:res-1:2026-09-01", "res-1", "2026-09-01"] });

    await handler(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledOnce();
    const [text, opts] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts).toMatchObject({ parse_mode: "HTML" });
    expect(text).toContain("&lt;b&gt;Стол 1&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(text).not.toContain("<script>alert(1)</script>");
  });
});
