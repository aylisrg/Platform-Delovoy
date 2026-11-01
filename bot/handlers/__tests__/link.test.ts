import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { cancelLink, confirmLink, handleLinkDeepLink, LINK_CANCEL, LINK_CONFIRM_PREFIX } from "../link";

type MockCtx = {
  reply: ReturnType<typeof vi.fn>;
  answerCallbackQuery: ReturnType<typeof vi.fn>;
  editMessageReplyMarkup: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
  from?: { id: number; first_name?: string; last_name?: string; username?: string };
};

function makeCtx(overrides: Partial<MockCtx> = {}): MockCtx {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    from: { id: 12345, first_name: "Иван" },
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

function sentBody(call = 0): Record<string, unknown> {
  const init = vi.mocked(fetch).mock.calls[call]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const TOKEN = "a".repeat(24);
const DEEP_LINK = `link_${TOKEN}`;

describe("handleLinkDeepLink — сначала подтверждение (ADR 2026-10-25 §Q9)", () => {
  it("ничего не привязывает: спрашивает, к чьему аккаунту ссылка, и даёт кнопки «Привязать / Отмена»", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, data: { userName: "Иван Петров", emailMasked: "iv***@mail.ru" } })
    );
    const ctx = makeCtx();

    await handleLinkDeepLink(ctx as never, DEEP_LINK);

    expect(sentBody()).toMatchObject({ token: TOKEN, telegramId: "12345", preview: true });
    const [text, opts] = ctx.reply.mock.calls[0];
    expect(text).toContain("Привязать этот Telegram к аккаунту <b>Иван Петров</b> (iv***@mail.ru)");
    expect(text).toContain("Если ссылку создавали не вы");
    const buttons = opts.reply_markup.inline_keyboard.flat();
    expect(buttons.map((b: { callback_data: string }) => b.callback_data)).toEqual([
      `${LINK_CONFIRM_PREFIX}${TOKEN}`,
      LINK_CANCEL,
    ]);
    expect(Buffer.byteLength(`${LINK_CONFIRM_PREFIX}${"f".repeat(48)}`)).toBeLessThanOrEqual(64);
  });

  it("экранирует userName (#534)", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: { userName: "<b>Хакер</b>", emailMasked: null } }));
    const ctx = makeCtx();

    await handleLinkDeepLink(ctx as never, DEEP_LINK);

    const [text, opts] = ctx.reply.mock.calls[0];
    expect(opts).toMatchObject({ parse_mode: "HTML" });
    expect(text).toContain("&lt;b&gt;Хакер&lt;/b&gt;");
    expect(text).not.toContain("<b>Хакер</b>");
  });

  it("недействительная ссылка — сообщение сервера, без кнопок", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: false, error: { code: "INVALID_TOKEN", message: "Ссылка устарела" } })
    );
    const ctx = makeCtx();

    await handleLinkDeepLink(ctx as never, DEEP_LINK);

    expect(ctx.reply).toHaveBeenCalledWith("Ссылка устарела");
  });

  it("короткий или кривой токен не уходит на сервер", async () => {
    const ctx = makeCtx();
    await handleLinkDeepLink(ctx as never, "link_short");
    await handleLinkDeepLink(ctx as never, `link_${"a".repeat(23)}:x`);
    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledTimes(2);
  });

  it("не link_ — не наш диплинк", async () => {
    expect(await handleLinkDeepLink(makeCtx() as never, "gazebos")).toBe(false);
  });
});

describe("confirmLink — «Привязать» (ADR 2026-10-25 §Q9, AC-E4.1)", () => {
  it("привязывает (без preview), убирает кнопки, экранирует имя", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: { userName: "<i>Иван</i>", merged: false } }));
    const ctx = makeCtx();

    await confirmLink(ctx as never, TOKEN);

    expect(sentBody().preview).toBeUndefined();
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalled();
    const [text] = ctx.reply.mock.calls[0];
    expect(text).toContain("Telegram привязан к аккаунту <b>&lt;i&gt;Иван&lt;/i&gt;</b>");
    expect(text).not.toContain("объединён");
  });

  it("говорит об объединении, когда аккаунт из бота влит в аккаунт сайта", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true, data: { userName: "Иван", merged: true } }));
    const ctx = makeCtx();

    await confirmLink(ctx as never, TOKEN);

    expect(ctx.reply.mock.calls[0][0]).toContain("объединён");
  });

  it("AC-E4.1: конфликт Telegram — текст запроса администратору, без «создайте новую ссылку»", async () => {
    const message =
      "Этот Telegram уже используется в другом аккаунте. Мы передали запрос администратору — он объединит аккаунты. Пока вы можете пользоваться текущим аккаунтом";
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: false, error: { code: "TELEGRAM_IN_USE_MERGE_REQUESTED", message } })
    );
    const ctx = makeCtx();

    await confirmLink(ctx as never, TOKEN);

    expect(ctx.reply).toHaveBeenCalledWith(message);
  });
});

describe("cancelLink — «Отмена»", () => {
  it("ничего не вызывает на сервере и заменяет вопрос на «отменено»", async () => {
    const ctx = makeCtx();

    await cancelLink(ctx as never);

    expect(fetch).not.toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalledWith("Привязка отменена. Telegram не привязан.");
  });
});
