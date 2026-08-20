import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBotFetch = vi.fn();
vi.mock('../../lib/api', () => ({
  botFetch: (...args: unknown[]) => mockBotFetch(...args),
  API_URL: 'http://test',
}));

import { registerOwnerDecisionsHandlers } from '../owner-decisions';

const OWNER_ID = 694696;

type Handler = (ctx: unknown, next?: () => Promise<void>) => Promise<void>;

/** Стаб Bot: собирает зарегистрированные хендлеры для прямого вызова в тестах. */
function makeBot() {
  const callbacks: { trigger: RegExp | string; fn: Handler }[] = [];
  const commands = new Map<string, Handler>();
  const listeners: Handler[] = [];
  return {
    callbackQuery: (trigger: RegExp | string, fn: Handler) => callbacks.push({ trigger, fn }),
    command: (name: string, fn: Handler) => commands.set(name, fn),
    on: (_event: string, fn: Handler) => listeners.push(fn),
    callbacks,
    commands,
    listeners,
  };
}

function findCallback(bot: ReturnType<typeof makeBot>, data: string) {
  for (const { trigger, fn } of bot.callbacks) {
    const match = trigger instanceof RegExp ? trigger.exec(data) : trigger === data ? [data] : null;
    if (match) return { fn, match };
  }
  throw new Error(`нет хендлера для ${data}`);
}

function makeCtx(over: Record<string, unknown> = {}) {
  return {
    from: { id: OWNER_ID },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('TELEGRAM_OWNER_CHAT_ID', String(OWNER_ID));
});

describe('owner-decisions bot handlers', () => {
  it('approve — двухшаговый confirm: первый тап только меняет клавиатуру, API не зовётся', async () => {
    const bot = makeBot();
    registerOwnerDecisionsHandlers(bot as never);

    const { fn, match } = findCallback(bot, 'ownerdec:dec1:approve');
    const ctx = makeCtx({ match });
    await fn(ctx);

    expect(ctx.editMessageReplyMarkup).toHaveBeenCalled();
    expect(mockBotFetch).not.toHaveBeenCalled();
  });

  it('confirm-approve зовёт API с action=approve и убирает кнопки', async () => {
    mockBotFetch.mockResolvedValue(jsonResponse({ success: true, data: { ack: '✅ Мерж через ~15 мин' } }));
    const bot = makeBot();
    registerOwnerDecisionsHandlers(bot as never);

    const { fn, match } = findCallback(bot, 'ownerdec:dec1:confirm-approve');
    const ctx = makeCtx({ match });
    await fn(ctx);

    const [path, opts] = mockBotFetch.mock.calls[0];
    expect(path).toBe('/api/bot/owner-decisions');
    expect(JSON.parse((opts as { body: string }).body)).toMatchObject({
      op: 'decide',
      decisionId: 'dec1',
      action: 'approve',
      telegramUserId: String(OWNER_ID),
    });
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: '✅ Мерж через ~15 мин' });
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({ reply_markup: undefined });
  });

  it('чужой пользователь получает «Недоступно» и API не зовётся', async () => {
    const bot = makeBot();
    registerOwnerDecisionsHandlers(bot as never);

    const { fn, match } = findCallback(bot, 'ownerdec:dec1:confirm-approve');
    const ctx = makeCtx({ from: { id: 111 }, match });
    await fn(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: 'Недоступно', show_alert: false });
    expect(mockBotFetch).not.toHaveBeenCalled();
  });

  it('«идея: …» от владельца уходит как op=idea', async () => {
    mockBotFetch.mockResolvedValue(jsonResponse({ success: true, data: { id: 'idea1', created: true } }));
    const bot = makeBot();
    registerOwnerDecisionsHandlers(bot as never);

    const next = vi.fn();
    const ctx = makeCtx({ message: { text: 'идея: тёмная тема на сайте' } });
    await bot.listeners[0](ctx, next);

    expect(JSON.parse((mockBotFetch.mock.calls[0][1] as { body: string }).body)).toMatchObject({
      op: 'idea',
      text: 'тёмная тема на сайте',
    });
    expect(next).not.toHaveBeenCalled();
    expect((ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('💡');
  });

  it('обычный текст владельца передаётся дальше (catch-all не ломается)', async () => {
    const bot = makeBot();
    registerOwnerDecisionsHandlers(bot as never);

    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ message: { text: 'привет' } });
    await bot.listeners[0](ctx, next);

    expect(next).toHaveBeenCalled();
    expect(mockBotFetch).not.toHaveBeenCalled();
  });

  it('текст не-владельца сразу уходит в next — модуль вообще не вмешивается', async () => {
    const bot = makeBot();
    registerOwnerDecisionsHandlers(bot as never);

    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = makeCtx({ from: { id: 111 }, message: { text: 'идея: чужая' } });
    await bot.listeners[0](ctx, next);

    expect(next).toHaveBeenCalled();
    expect(mockBotFetch).not.toHaveBeenCalled();
  });
});
