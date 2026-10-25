import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * /api/users/merge/search, /api/users/merge/preview, /api/users/merge —
 * ADR 2026-10-25-team-access-notifications §6.1/§6.2, PRD US-E2 (AC-E2.11 RBAC).
 */

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ rateLimit: (...args: unknown[]) => mockRateLimit(...args) }));

const mockSearch = vi.fn();
const mockPreview = vi.fn();
const mockMerge = vi.fn();
vi.mock("@/modules/clients/merge", () => ({
  searchMergeCandidates: (...args: unknown[]) => mockSearch(...args),
  previewAccountMerge: (...args: unknown[]) => mockPreview(...args),
  mergeAccounts: (...args: unknown[]) => mockMerge(...args),
}));

import { GET as searchRoute } from "../search/route";
import { POST as previewRoute } from "../preview/route";
import { POST as mergeRoute } from "../route";
import { DomainError } from "@/modules/users/errors";

const SUPERADMIN = { user: { id: "sa-1", role: "SUPERADMIN", adminSections: [] } };

const search = (qs = "q=иван") => searchRoute(new NextRequest(`http://localhost/api/users/merge/search?${qs}`));
const post = (route: (r: Request) => Promise<Response>, body: string) =>
  route(new Request("http://localhost/api/users/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body }));
const preview = (body: unknown) => post(previewRoute, typeof body === "string" ? body : JSON.stringify(body));
const merge = (body: unknown) => post(mergeRoute, typeof body === "string" ? body : JSON.stringify(body));

const pair = { primaryId: "p", secondaryId: "s" };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SUPERADMIN);
  mockRateLimit.mockResolvedValue(null);
});

describe("RBAC (AC-E2.11)", () => {
  const calls: Array<[string, () => Promise<Response>]> = [
    ["GET search", () => search()],
    ["POST preview", () => preview(pair)],
    ["POST merge", () => merge({ ...pair, confirmIrreversible: true })],
  ];

  it.each(calls)("%s: 401 without a session", async (_l, call) => {
    mockAuth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it.each([
    ["ADMIN with the «Пользователи» section", { id: "a", role: "ADMIN", adminSections: ["users"] }],
    ["MANAGER with the «Пользователи» section", { id: "m", role: "MANAGER", adminSections: ["users"] }],
    ["USER", { id: "u", role: "USER", adminSections: [] }],
  ])("AC-E2.11: 403 for %s on every merge endpoint", async (_l, user) => {
    mockAuth.mockResolvedValue({ user });
    for (const [, call] of calls) expect((await call()).status).toBe(403);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockPreview).not.toHaveBeenCalled();
    expect(mockMerge).not.toHaveBeenCalled();
  });
});

describe("GET /api/users/merge/search", () => {
  it("AC-E2.1: 200 with hits; per-user rate limit (debounced keystrokes)", async () => {
    mockSearch.mockResolvedValue([{ id: "u1", name: "Иван", role: "USER", email: null, phone: null, hasTelegram: true }]);
    const res = await search("q=%20иван%20&exclude=p");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
    expect(mockSearch).toHaveBeenCalledWith("иван", "p");
    expect(mockRateLimit).toHaveBeenCalledWith(expect.anything(), "authenticated", "sa-1");
  });

  it("422 for a too-short query; 429 passes through", async () => {
    expect((await search("q=и")).status).toBe(422);
    mockRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await search()).status).toBe(429);
    expect(mockSearch).not.toHaveBeenCalled();
  });
});

describe("POST /api/users/merge/preview", () => {
  it("AC-E2.3: 200 with the preview for the actor (mode admin)", async () => {
    mockPreview.mockResolvedValue({ suggestedPrimaryId: "p", blockers: [] });
    const res = await preview(pair);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ suggestedPrimaryId: "p", blockers: [] });
    expect(mockPreview).toHaveBeenCalledWith({ primaryId: "p", secondaryId: "s", actorId: "sa-1", mode: "admin" });
  });

  it("422 SAME_ACCOUNT, 422 bad JSON, 404 domain error passes through", async () => {
    const same = await preview({ primaryId: "a", secondaryId: "a" });
    expect(same.status).toBe(422);
    expect((await same.json()).error.code).toBe("SAME_ACCOUNT");
    expect((await preview("{oops")).status).toBe(422);

    mockPreview.mockRejectedValueOnce(new DomainError("USER_NOT_FOUND", "Пользователь не найден", 404));
    const missing = await preview(pair);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("USER_NOT_FOUND");
  });

  it("500 without details for unexpected errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockPreview.mockRejectedValueOnce(new Error("SELECT … secret"));
    const res = await preview(pair);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("POST /api/users/merge", () => {
  it("AC-E2.5: 200 — merges with the confirmations, actor from the session", async () => {
    mockMerge.mockResolvedValue({ primaryId: "p", tombstonedUserId: "s", resultingRole: "MANAGER", moved: { bookings: 2 } });
    const res = await merge({ ...pair, confirmIrreversible: true, confirmTelegramConflict: true });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ primaryId: "p", tombstonedUserId: "s", resultingRole: "MANAGER", moved: { bookings: 2 } });
    expect(mockMerge).toHaveBeenCalledWith({
      primaryId: "p",
      secondaryId: "s",
      actorId: "sa-1",
      mode: "admin",
      confirmTelegramConflict: true,
    });
  });

  it("AC-E2.5: 422 without confirmIrreversible", async () => {
    expect((await merge(pair)).status).toBe(422);
    expect(mockMerge).not.toHaveBeenCalled();
  });

  it.each([
    ["ALREADY_MERGED", "Этот аккаунт уже объединён с другим"],
    ["SECONDARY_IS_ACTOR", "Нельзя объединить аккаунт, под которым вы вошли. Выберите его основным"],
    ["SECONDARY_SEEDED_SUPERADMIN", "Этот аккаунт привязан к настройке сервера. Выберите его основным"],
    ["TELEGRAM_CONFLICT_UNCONFIRMED", "У аккаунтов разные Telegram — подтвердите, какой оставить"],
  ])("409 %s is passed through with its text", async (code, message) => {
    mockMerge.mockRejectedValueOnce(new DomainError(code, message, 409));
    const res = await merge({ ...pair, confirmIrreversible: true });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({ code, message });
  });
});
