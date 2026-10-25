import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/users/merge-requests, PATCH /api/users/merge-requests/[id] —
 * ADR 2026-10-25 §6.1/§6.2, PRD US-E4 (AC-E4.3).
 */

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockList = vi.fn();
const mockDismiss = vi.fn();
vi.mock("@/modules/clients/merge-requests", () => ({
  listMergeRequests: (...args: unknown[]) => mockList(...args),
  dismissMergeRequest: (...args: unknown[]) => mockDismiss(...args),
}));

import { GET } from "../route";
import { PATCH } from "../[id]/route";
import { DomainError } from "@/modules/users/errors";

const SUPERADMIN = { user: { id: "sa-1", role: "SUPERADMIN", adminSections: [] } };

const list = (qs = "") => GET(new NextRequest(`http://localhost/api/users/merge-requests${qs}`));
const patch = (body: string, id = "mc-1") =>
  PATCH(
    new Request(`http://localhost/api/users/merge-requests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SUPERADMIN);
});

describe("RBAC (AC-E2.11 / AC-E4.3)", () => {
  it("401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await list()).status).toBe(401);
    expect((await patch('{"action":"dismiss"}')).status).toBe(401);
  });

  it.each([
    ["ADMIN with the «Пользователи» section", { id: "a", role: "ADMIN", adminSections: ["users"] }],
    ["MANAGER", { id: "m", role: "MANAGER", adminSections: ["users"] }],
    ["USER", { id: "u", role: "USER", adminSections: [] }],
  ])("403 for %s", async (_l, user) => {
    mockAuth.mockResolvedValue({ user });
    expect((await list()).status).toBe(403);
    expect((await patch('{"action":"dismiss"}')).status).toBe(403);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
  });
});

describe("GET /api/users/merge-requests", () => {
  it("AC-E4.3: 200 with the open requests and meta.total", async () => {
    mockList.mockResolvedValue([{ id: "mc-1" }, { id: "mc-2" }]);
    const res = await list("?userId=u-1");
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    expect(json.meta).toEqual({ total: 2 });
    expect(mockList).toHaveBeenCalledWith({ status: "PENDING", userId: "u-1" });
  });

  it("422 for an oversized userId", async () => {
    expect((await list(`?userId=${"x".repeat(65)}`)).status).toBe(422);
  });
});

describe("PATCH /api/users/merge-requests/[id]", () => {
  it("AC-E4.3: «Это разные люди» → 200 RESOLVED_KEPT_SEPARATE by the session actor", async () => {
    mockDismiss.mockResolvedValue({ id: "mc-1", status: "RESOLVED_KEPT_SEPARATE" });
    const res = await patch('{"action":"dismiss"}');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: "mc-1", status: "RESOLVED_KEPT_SEPARATE" });
    expect(mockDismiss).toHaveBeenCalledWith("mc-1", "sa-1");
  });

  it("422 for another action / extra keys / bad JSON", async () => {
    expect((await patch('{"action":"merge"}')).status).toBe(422);
    expect((await patch('{"action":"dismiss","x":1}')).status).toBe(422);
    expect((await patch("{")).status).toBe(422);
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it("404 unknown / 409 already closed", async () => {
    mockDismiss.mockRejectedValueOnce(new DomainError("MERGE_REQUEST_NOT_FOUND", "Запрос на объединение не найден", 404));
    expect((await patch('{"action":"dismiss"}')).status).toBe(404);
    mockDismiss.mockRejectedValueOnce(new DomainError("MERGE_REQUEST_CLOSED", "Запрос на объединение уже закрыт", 409));
    const closed = await patch('{"action":"dismiss"}');
    expect(closed.status).toBe(409);
    expect((await closed.json()).error.code).toBe("MERGE_REQUEST_CLOSED");
  });
});
