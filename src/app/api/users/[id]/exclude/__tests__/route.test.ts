import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * GET/POST /api/users/[id]/exclude — ADR 2026-10-25-team-access-notifications
 * §6.1/§6.2, PRD AC-A1.10 (RBAC) / AC-A1.6 (guards) / AC-A1.7 (seeded).
 */

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockPreview = vi.fn();
const mockExclude = vi.fn();
vi.mock("@/modules/users/exclusion", () => ({
  getExclusionPreview: (...args: unknown[]) => mockPreview(...args),
  excludeFromTeam: (...args: unknown[]) => mockExclude(...args),
}));

import { GET, POST } from "../route";
import { DomainError } from "@/modules/users/errors";

const params = (id = "mgr-1") => ({ params: Promise.resolve({ id }) });

const get = (id?: string) => GET(new Request("http://localhost/api/users/mgr-1/exclude"), params(id));

const post = (body?: string, id?: string) =>
  POST(
    new Request("http://localhost/api/users/mgr-1/exclude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body } : {}),
    }),
    params(id),
  );

const SUPERADMIN = { user: { id: "sa-1", role: "SUPERADMIN", adminSections: [] } };

const exclusionResult = {
  userId: "mgr-1",
  role: "USER",
  removed: { sections: ["cafe"], modules: ["cafe"], recipientLists: ["cafe"], subscriptions: ["order.placed"] },
  sessionsRevoked: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SUPERADMIN);
});

describe("RBAC (AC-A1.10)", () => {
  it.each([
    ["GET", () => get()],
    ["POST", () => post("{}")],
  ])("%s: 401 without a session", async (_method, call) => {
    mockAuth.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(mockPreview).not.toHaveBeenCalled();
    expect(mockExclude).not.toHaveBeenCalled();
  });

  it.each([
    ["ADMIN with the «Пользователи» section", { id: "adm-1", role: "ADMIN", adminSections: ["users"] }],
    ["MANAGER with the «Пользователи» section", { id: "m-1", role: "MANAGER", adminSections: ["users"] }],
    ["USER", { id: "u-1", role: "USER", adminSections: [] }],
  ])("AC-A1.10: 403 for %s (GET and POST)", async (_label, user) => {
    mockAuth.mockResolvedValue({ user });
    expect((await get()).status).toBe(403);
    expect((await post("{}")).status).toBe(403);
    expect(mockPreview).not.toHaveBeenCalled();
    expect(mockExclude).not.toHaveBeenCalled();
  });
});

describe("GET /api/users/[id]/exclude", () => {
  it("AC-A1.2: 200 with the preview for the actor", async () => {
    const preview = { user: { id: "mgr-1", name: "Иван", role: "MANAGER" }, guard: null };
    mockPreview.mockResolvedValue(preview);

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: preview });
    expect(mockPreview).toHaveBeenCalledWith("mgr-1", "sa-1");
  });

  it("404 USER_NOT_FOUND from the service", async () => {
    mockPreview.mockRejectedValue(new DomainError("USER_NOT_FOUND", "Пользователь не найден", 404));
    const res = await get();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("USER_NOT_FOUND");
  });

  it("422 for an id that is too long", async () => {
    const res = await get("x".repeat(65));
    expect(res.status).toBe(422);
    expect(mockPreview).not.toHaveBeenCalled();
  });
});

describe("POST /api/users/[id]/exclude", () => {
  it("AC-A1.3: 200 with the exclusion result; actor from the session, via=exclude", async () => {
    mockExclude.mockResolvedValue(exclusionResult);

    const res = await post("{}");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: exclusionResult });
    expect(mockExclude).toHaveBeenCalledWith("mgr-1", "sa-1", { confirmSeeded: undefined, via: "exclude" });
  });

  it("an empty body is accepted (no confirmations)", async () => {
    mockExclude.mockResolvedValue(exclusionResult);
    const res = await post();
    expect(res.status).toBe(200);
    expect(mockExclude).toHaveBeenCalledWith("mgr-1", "sa-1", { confirmSeeded: undefined, via: "exclude" });
  });

  it("AC-A1.7: forwards confirmSeeded", async () => {
    mockExclude.mockResolvedValue(exclusionResult);
    await post(JSON.stringify({ confirmSeeded: true }));
    expect(mockExclude).toHaveBeenCalledWith("mgr-1", "sa-1", { confirmSeeded: true, via: "exclude" });
  });

  it("AC-A1.6: 409 LAST_SUPERADMIN with the Russian message", async () => {
    mockExclude.mockRejectedValue(
      new DomainError("LAST_SUPERADMIN", "Нельзя исключить последнего суперадмина. Сначала назначьте другого", 409),
    );
    const res = await post("{}");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: {
        code: "LAST_SUPERADMIN",
        message: "Нельзя исключить последнего суперадмина. Сначала назначьте другого",
      },
    });
  });

  it("AC-A1.7: 409 SEEDED_SUPERADMIN_CONFIRM_REQUIRED keeps metadata", async () => {
    mockExclude.mockRejectedValue(
      new DomainError("SEEDED_SUPERADMIN_CONFIRM_REQUIRED", "…", 409, { requiresConfirmation: "seeded_superadmin" }),
    );
    const res = await post("{}");
    expect(res.status).toBe(409);
    expect((await res.json()).error.metadata).toEqual({ requiresConfirmation: "seeded_superadmin" });
  });

  it("AC-A1.6: 400 CANNOT_EXCLUDE_SELF", async () => {
    mockExclude.mockRejectedValue(new DomainError("CANNOT_EXCLUDE_SELF", "Нельзя исключить самого себя", 400));
    const res = await post("{}");
    expect(res.status).toBe(400);
  });

  it("422 VALIDATION_ERROR on unknown keys (strict schema) and malformed JSON", async () => {
    expect((await post(JSON.stringify({ confirmSeeded: true, role: "USER" }))).status).toBe(422);
    expect((await post("{not json")).status).toBe(422);
    expect(mockExclude).not.toHaveBeenCalled();
  });

  it("500 without internal details on unexpected errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockExclude.mockRejectedValue(new Error("connection to 10.0.0.5 refused"));
    const res = await post("{}");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.5");
  });
});
