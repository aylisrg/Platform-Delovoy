import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { handleLinkDeepLink } from "../link";

type MockCtx = {
  reply: ReturnType<typeof vi.fn>;
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
};

function makeCtx(overrides: Partial<MockCtx> = {}): MockCtx {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    from: { id: 12345, first_name: "Иван" },
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

const VALID_TOKEN = "link_" + "a".repeat(24);

describe("handleLinkDeepLink — экранирование userName (#534)", () => {
  it("экранирует userName из ответа сервера перед подстановкой в HTML-сообщение", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: { userName: "<b>Хакер</b>" } })
    );
    const ctx = makeCtx();

    await handleLinkDeepLink(ctx as never, VALID_TOKEN);

    expect(ctx.reply).toHaveBeenCalledOnce();
    const [text, opts] = ctx.reply.mock.calls[0];
    expect(opts).toMatchObject({ parse_mode: "HTML" });
    expect(text).toContain("&lt;b&gt;Хакер&lt;/b&gt;");
    expect(text).not.toContain("<b>Хакер</b>");
  });

  it("не ломает обычные имена без спецсимволов", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: { userName: "Иван Петров" } })
    );
    const ctx = makeCtx();

    await handleLinkDeepLink(ctx as never, VALID_TOKEN);

    const [text] = ctx.reply.mock.calls[0];
    expect(text).toContain("Иван Петров");
  });
});

describe("handleLinkDeepLink — объединение и конфликт (ADR 2026-10-25 §Q9, AC-E4.1)", () => {
  it("говорит об объединении, когда аккаунт из бота влит в аккаунт сайта", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: { userName: "Иван", merged: true } })
    );
    const ctx = makeCtx();

    await handleLinkDeepLink(ctx as never, VALID_TOKEN);

    const [text] = ctx.reply.mock.calls[0];
    expect(text).toContain("Telegram привязан к аккаунту <b>Иван</b>");
    expect(text).toContain("объединён");
  });

  it("без merged — прежний текст без строки об объединении", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: { userName: "Иван", merged: false } }));
    const ctx = makeCtx();

    await handleLinkDeepLink(ctx as never, VALID_TOKEN);

    expect(ctx.reply.mock.calls[0][0]).not.toContain("объединён");
  });

  it("AC-E4.1: конфликт Telegram — текст запроса администратору, без «создайте новую ссылку»", async () => {
    const message =
      "Этот Telegram уже используется в другом аккаунте. Мы передали запрос администратору — он объединит аккаунты. Пока вы можете пользоваться текущим аккаунтом";
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: false, error: { code: "TELEGRAM_IN_USE_MERGE_REQUESTED", message } })
    );
    const ctx = makeCtx();

    await handleLinkDeepLink(ctx as never, VALID_TOKEN);

    expect(ctx.reply).toHaveBeenCalledWith(message);
  });
});
