import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// Регресс-страховка: тумблер релизов переехал в Центр уведомлений, бот
// больше не должен писать предпочтения ни через одно из имён (AC-6.4).
const mockSetReleaseSubscription = vi.fn();
vi.mock("@/modules/notifications/release-notify", () => ({
  setReleaseSubscription: (...args: unknown[]) => mockSetReleaseSubscription(...args),
  setReleaseNotifyPreference: (...args: unknown[]) =>
    mockSetReleaseSubscription(...args),
}));

import { prisma } from "@/lib/db";
import {
  getTeamUser,
  settingsKeyboard,
  settingsText,
  registerTeamSettingsHandlers,
} from "../team-settings";

type Handler = (ctx: unknown) => Promise<void>;

function collectHandlers() {
  const commands = new Map<string, Handler>();
  const callbacks: Array<{ pattern: RegExp; handler: Handler }> = [];
  const fakeBot = {
    command: (name: string, handler: Handler) => commands.set(name, handler),
    callbackQuery: (pattern: RegExp, handler: Handler) =>
      callbacks.push({ pattern, handler }),
  };
  registerTeamSettingsHandlers(fakeBot as never);
  return { commands, callbacks };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  return {
    from: { id: 12345 },
    reply: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    match: ["settings:releases:on", "on"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://delovoy-park.ru");
});

describe("getTeamUser — доступ всей команде парка", () => {
  it.each(["SUPERADMIN", "ADMIN", "MANAGER"])("пускает %s", async (role) => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role,
    } as never);

    expect(await getTeamUser("12345")).toEqual({ id: "u-1", role });
  });

  it("не пускает обычного USER", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-3",
      role: "USER",
    } as never);

    expect(await getTeamUser("12345")).toBeNull();
  });

  it("возвращает null, если аккаунт не связан с платформой", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

    expect(await getTeamUser("12345")).toBeNull();
  });
});

describe("настройки переехали в Центр уведомлений", () => {
  it("текст сообщает о переезде", () => {
    expect(settingsText()).toContain("Центр уведомлений");
    expect(settingsText()).not.toContain("Релизы");
  });

  it("клавиатура — одна web_app-кнопка на /webapp/notifications", () => {
    const row = settingsKeyboard().inline_keyboard[0];

    expect(row).toHaveLength(1);
    expect("web_app" in row[0] ? row[0].web_app.url : "").toBe(
      "https://delovoy-park.ru/webapp/notifications",
    );
    expect("callback_data" in row[0]).toBe(false);
  });

  it("/settings отвечает команде ссылкой на Центр", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "ADMIN",
    } as never);
    const { commands } = collectHandlers();
    const ctx = makeCtx();

    await commands.get("settings")!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Центр уведомлений"),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });

  it("/settings отшивает обычного USER", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-3",
      role: "USER",
    } as never);
    const { commands } = collectHandlers();
    const ctx = makeCtx();

    await commands.get("settings")!(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("только команде парка"),
    );
  });
});

describe("legacy callback settings:releases:*", () => {
  it("ничего не пишет, а перенаправляет в Центр", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "MANAGER",
    } as never);
    const { callbacks } = collectHandlers();
    const ctx = makeCtx();

    await callbacks[0].handler(ctx);

    expect(mockSetReleaseSubscription).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "Настройка переехала",
    });
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("Центр уведомлений"),
      expect.objectContaining({ reply_markup: expect.anything() }),
    );
  });

  it("старая кнопка 'off' тоже ничего не пишет", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-1",
      role: "MANAGER",
    } as never);
    const { callbacks } = collectHandlers();
    const ctx = makeCtx({ match: ["settings:releases:off", "off"] });

    await callbacks[0].handler(ctx);

    expect(mockSetReleaseSubscription).not.toHaveBeenCalled();
  });

  it("не отвечает данными пользователю вне команды", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u-3",
      role: "USER",
    } as never);
    const { callbacks } = collectHandlers();
    const ctx = makeCtx();

    await callbacks[0].handler(ctx);

    expect(ctx.editMessageText).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "Только для команды парка",
      show_alert: true,
    });
  });

  it("паттерн ловит и on, и off", () => {
    const { callbacks } = collectHandlers();
    expect(callbacks[0].pattern.test("settings:releases:on")).toBe(true);
    expect(callbacks[0].pattern.test("settings:releases:off")).toBe(true);
  });
});
