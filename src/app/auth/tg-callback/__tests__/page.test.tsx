/* @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dlMocks = vi.hoisted(() => ({
  readBotLoginToken: vi.fn(),
  consumeBotLoginToken: vi.fn(),
  mintOneTimeJwt: vi.fn(),
}));

vi.mock("@/modules/auth/telegram-deep-link", () => dlMocks);

const authMock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

vi.mock("@/lib/audit", () => ({
  logAuthEvent: vi.fn(async () => undefined),
  hashIp: vi.fn(() => "iphash"),
  maskChatId: vi.fn((s: string) => s),
}));

const redirectMock = vi.hoisted(() => vi.fn((url: string) => {
  const err = new Error(`NEXT_REDIRECT:${url}`);
  // Mimic next/navigation redirect throwing — caller treats as completion.
  throw err;
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import TgCallbackPage from "../page";

async function render(searchParams: { token?: string }) {
  const element = await TgCallbackPage({
    searchParams: Promise.resolve(searchParams),
  });
  return element as { type: unknown; props: Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.auth.mockResolvedValue(null);
});

describe("/auth/tg-callback page", () => {
  it("renders error UI when token query is missing", async () => {
    const el = await render({});
    expect(JSON.stringify(el)).toContain("Некорректная ссылка");
    expect(dlMocks.readBotLoginToken).not.toHaveBeenCalled();
  });

  it("renders 'expired' error when token is unknown in Redis", async () => {
    dlMocks.readBotLoginToken.mockResolvedValueOnce(null);
    const el = await render({ token: "ghost" });
    expect(JSON.stringify(el)).toContain("Срок ссылки истёк");
  });

  it("renders 'already used' error when status != PENDING", async () => {
    dlMocks.readBotLoginToken.mockResolvedValueOnce({
      status: "CONSUMED",
      userId: "u-1",
      createdAt: new Date().toISOString(),
      telegramIdHash: "abc",
    });
    const el = await render({ token: "used" });
    expect(JSON.stringify(el)).toContain("уже использована");
  });

  it("anonymous: consumes, mints JWT, hands signin mode to client", async () => {
    dlMocks.readBotLoginToken.mockResolvedValueOnce({
      status: "PENDING",
      userId: "u-anon",
      createdAt: new Date().toISOString(),
      telegramIdHash: "abc",
    });
    dlMocks.consumeBotLoginToken.mockResolvedValueOnce({
      ok: true,
      userId: "u-anon",
    });
    dlMocks.mintOneTimeJwt.mockResolvedValueOnce("jwt-xyz");

    const el = await render({ token: "tok-1" });
    // CallbackClient is rendered as a JSX element. Inspect its props.
    expect(el.props.mode).toBe("signin");
    expect(el.props.token).toBe("tok-1");
    expect(el.props.oneTimeCode).toBe("jwt-xyz");
    expect(dlMocks.consumeBotLoginToken).toHaveBeenCalledWith("tok-1");
    expect(dlMocks.mintOneTimeJwt).toHaveBeenCalledWith("u-anon");
  });

  it("anonymous: error UI when consume returns already_used (race)", async () => {
    dlMocks.readBotLoginToken.mockResolvedValueOnce({
      status: "PENDING",
      userId: "u-r",
      createdAt: new Date().toISOString(),
      telegramIdHash: "abc",
    });
    dlMocks.consumeBotLoginToken.mockResolvedValueOnce({
      ok: false,
      reason: "already_used",
    });

    const el = await render({ token: "tok-race" });
    expect(JSON.stringify(el)).toContain("уже использована");
    expect(dlMocks.mintOneTimeJwt).not.toHaveBeenCalled();
  });

  it("anonymous: 'server not configured' error when JWT mint returns null", async () => {
    dlMocks.readBotLoginToken.mockResolvedValueOnce({
      status: "PENDING",
      userId: "u-noenv",
      createdAt: new Date().toISOString(),
      telegramIdHash: "abc",
    });
    dlMocks.consumeBotLoginToken.mockResolvedValueOnce({
      ok: true,
      userId: "u-noenv",
    });
    dlMocks.mintOneTimeJwt.mockResolvedValueOnce(null);

    const el = await render({ token: "tok-noenv" });
    expect(JSON.stringify(el)).toContain("Сервер не настроен");
  });

  it("session-conflict: renders confirm UI without consuming token", async () => {
    authMock.auth.mockResolvedValueOnce({
      user: { id: "u-current", name: "Alice" },
    });
    dlMocks.readBotLoginToken.mockResolvedValueOnce({
      status: "PENDING",
      userId: "u-other",
      createdAt: new Date().toISOString(),
      telegramIdHash: "abc",
    });

    const el = await render({ token: "tok-conf" });
    expect(el.props.mode).toBe("conflict");
    expect(el.props.currentDisplayName).toBe("Alice");
    expect(el.props.token).toBe("tok-conf");
    expect(dlMocks.consumeBotLoginToken).not.toHaveBeenCalled();
    expect(dlMocks.mintOneTimeJwt).not.toHaveBeenCalled();
  });

  it("same user: consumes silently and redirects to /profile", async () => {
    authMock.auth.mockResolvedValueOnce({
      user: { id: "u-same", name: "Bob" },
    });
    dlMocks.readBotLoginToken.mockResolvedValueOnce({
      status: "PENDING",
      userId: "u-same",
      createdAt: new Date().toISOString(),
      telegramIdHash: "abc",
    });
    dlMocks.consumeBotLoginToken.mockResolvedValueOnce({
      ok: true,
      userId: "u-same",
    });

    await expect(render({ token: "tok-same" })).rejects.toThrow(
      "NEXT_REDIRECT:/profile"
    );
    expect(dlMocks.consumeBotLoginToken).toHaveBeenCalledWith("tok-same");
    expect(dlMocks.mintOneTimeJwt).not.toHaveBeenCalled();
  });
});
