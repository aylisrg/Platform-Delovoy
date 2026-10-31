// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { TelegramProvider, useTelegram } from "../TelegramProvider";

type Ctx = ReturnType<typeof useTelegram>;
let ctx: Ctx | null = null;
function Probe({ onCtx }: { onCtx: (c: Ctx) => void }) {
  const value = useTelegram();
  useEffect(() => onCtx(value));
  return null;
}
const capture = (c: Ctx) => {
  ctx = c;
};

function json(status: number, body: unknown) {
  return { status, ok: status < 400, json: async () => body } as Response;
}

const session = (token: string, role = "USER") => ({
  success: true,
  data: { token, user: { id: "u1", name: "Иван", role, image: null, telegramId: "42" } },
});

beforeEach(() => {
  ctx = null;
  (window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: { initData: "init", ready: vi.fn(), expand: vi.fn() },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("apiFetch — revoked token (ADR 2026-10-25 §Q1)", () => {
  it("re-issues the token once from initData after a 401 and retries", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const auth = new Headers(init?.headers).get("Authorization");
      if (url === "/api/webapp/auth") {
        return json(200, fetchMock.mock.calls.length === 1 ? session("old") : session("fresh"));
      }
      if (auth === "Bearer old") return json(401, { success: false, error: { code: "UNAUTHORIZED" } });
      return json(200, { success: true, data: { ok: auth } });
    });

    render(
      <TelegramProvider>
        <Probe onCtx={capture} />
      </TelegramProvider>,
    );
    await waitFor(() => expect(ctx?.token).toBe("old"));

    let result: unknown;
    await act(async () => {
      result = await ctx!.apiFetch("/api/webapp/feed");
    });
    expect(result).toEqual({ ok: "Bearer fresh" });
    const authCalls = fetchMock.mock.calls.filter(([u]) => u === "/api/webapp/auth");
    expect(authCalls).toHaveLength(2);
  });

  it("does not loop: a second 401 surfaces as an error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (url === "/api/webapp/auth") return json(200, session("t"));
      return json(401, { success: false, error: { code: "UNAUTHORIZED", message: "no" } });
    });

    render(
      <TelegramProvider>
        <Probe onCtx={capture} />
      </TelegramProvider>,
    );
    await waitFor(() => expect(ctx?.token).toBe("t"));
    await expect(ctx!.apiFetch("/api/webapp/feed")).rejects.toMatchObject({ status: 401 });
  });
});

describe("Telegram back navigation", () => {
  it("replaces the old screen handler and removes it on screen exit", async () => {
    const handlers = new Set<() => void>();
    const button = { show: vi.fn(), hide: vi.fn(), onClick: (cb: () => void) => handlers.add(cb), offClick: (cb: () => void) => handlers.delete(cb) };
    Object.assign(window.Telegram.WebApp, { BackButton: button });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, session("fixture")));
    render(<TelegramProvider><Probe onCtx={capture} /></TelegramProvider>);
    await waitFor(() => expect(ctx?.ready).toBe(true));
    const oldScreen = vi.fn(); const center = vi.fn();
    ctx!.onBackButtonClick(oldScreen); ctx!.onBackButtonClick(center);
    handlers.forEach(cb => cb());
    expect(oldScreen).not.toHaveBeenCalled(); expect(center).toHaveBeenCalledTimes(1);
    ctx!.showBackButton(false);
    expect(handlers.size).toBe(0);
  });
});
