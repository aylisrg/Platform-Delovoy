// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { SessionWatcher, sessionFingerprint, SESSION_WATCH_INTERVAL_MS } from "../session-watcher";

const assign = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: assign }) }));
const reload = vi.fn();

function sessionResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, pathname: "/admin/users", search: "?tab=team", reload },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  assign.mockReset();
  reload.mockReset();
});

describe("sessionFingerprint", () => {
  it("is null for an empty session and stable regardless of section order", () => {
    expect(sessionFingerprint(null)).toBeNull();
    expect(sessionFingerprint({})).toBeNull();
    expect(sessionFingerprint({ user: { role: "MANAGER", adminSections: ["cafe", "dashboard"] } })).toBe(
      sessionFingerprint({ user: { role: "MANAGER", adminSections: ["dashboard", "cafe"] } }),
    );
  });
});

describe("SessionWatcher (ADR 2026-10-25 §Q1, AC-A1.5)", () => {
  it("reloads the tab once role/sections change on the server", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sessionResponse({ user: { role: "MANAGER", adminSections: ["cafe"] } }))
      .mockResolvedValue(sessionResponse({ user: { role: "USER", adminSections: [] } }));

    render(<SessionWatcher />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("sends a signed-out tab to sign-in with a callback back to the page", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(sessionResponse(null));
    render(<SessionWatcher />);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(`/auth/signin?callbackUrl=${encodeURIComponent("/admin/users?tab=team")}`),
    );
  });

  it("ignores network errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    render(<SessionWatcher />);
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS);
    expect(assign).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
