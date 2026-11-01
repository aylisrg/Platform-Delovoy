import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockDeleteUser = vi.fn();
const mockUpdateUser = vi.fn();
vi.mock("@/modules/users/service", () => ({
  deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
  updateUser: (...args: unknown[]) => mockUpdateUser(...args),
  getUser: vi.fn(),
}));

import { DELETE, PATCH } from "../route";
import { DomainError } from "@/modules/users/errors";

const params = { params: Promise.resolve({ id: "user-1" }) };

const callDelete = () =>
  DELETE(new Request("http://localhost/api/users/user-1", { method: "DELETE" }), params);

const callPatch = (body: string) =>
  PATCH(
    new Request("http://localhost/api/users/user-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ id: "user-1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "SUPERADMIN" } });
});

describe("DELETE /api/users/[id]", () => {
  it("AC-A3.5: 200 when an account without history is deleted", async () => {
    mockDeleteUser.mockResolvedValue(undefined);
    const res = await callDelete();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { deleted: true } });
    expect(mockDeleteUser).toHaveBeenCalledWith("user-1", "admin-1");
  });

  it("AC-A3.1: 409 USER_HAS_HISTORY with metadata.blockers and isTeamMember", async () => {
    const blockers = [
      { type: "AuditLog", label: "Журнал действий", count: 214 },
      { type: "Subscription", label: "Абонементы Плей Парка", count: 2 },
    ];
    mockDeleteUser.mockRejectedValue(
      new DomainError("USER_HAS_HISTORY", "Удалить нельзя: у аккаунта есть история.", 409, {
        blockers,
        isTeamMember: true,
      }),
    );

    const res = await callDelete();

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("USER_HAS_HISTORY");
    expect(body.error.metadata).toEqual({ blockers, isTeamMember: true });
  });

  it("AC-A3.5: 400 CANNOT_DELETE_SELF and 404 USER_NOT_FOUND are shown, not 500", async () => {
    mockDeleteUser.mockRejectedValueOnce(new DomainError("CANNOT_DELETE_SELF", "Нельзя удалить самого себя", 400));
    expect((await callDelete()).status).toBe(400);

    mockDeleteUser.mockRejectedValueOnce(new DomainError("USER_NOT_FOUND", "Пользователь не найден", 404));
    expect((await callDelete()).status).toBe(404);
  });

  it("500 on unknown errors, without details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockDeleteUser.mockRejectedValue(new Error("boom: secret"));
    const res = await callDelete();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });

  it("401 without a session, 403 for non-superadmin (incl. ADMIN with «Пользователи»)", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect((await callDelete()).status).toBe(401);

    mockAuth.mockResolvedValueOnce({ user: { id: "m", role: "MANAGER" } });
    expect((await callDelete()).status).toBe(403);

    mockAuth.mockResolvedValueOnce({ user: { id: "a", role: "ADMIN", adminSections: ["users"] } });
    expect((await callDelete()).status).toBe(403);

    expect(mockDeleteUser).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/users/[id]", () => {
  it("AC-A2.1: role USER → response carries the exclusion; confirmSeeded is forwarded", async () => {
    const exclusion = {
      userId: "user-1",
      role: "USER",
      removed: { sections: [], modules: [], recipientLists: [], subscriptions: [] },
      sessionsRevoked: true,
    };
    mockUpdateUser.mockResolvedValue({ id: "user-1", role: "USER", exclusion });

    const res = await callPatch(JSON.stringify({ role: "USER", confirmSeeded: true }));

    expect(res.status).toBe(200);
    expect((await res.json()).data.exclusion).toEqual(exclusion);
    expect(mockUpdateUser).toHaveBeenCalledWith("user-1", { role: "USER", confirmSeeded: true }, "admin-1");
  });

  it("maps guard errors: CANNOT_DEMOTE_SELF 400, LAST_SUPERADMIN 409, SEEDED metadata", async () => {
    mockUpdateUser.mockRejectedValueOnce(
      new DomainError("CANNOT_DEMOTE_SELF", "Нельзя понизить роль самому себе", 400),
    );
    expect((await callPatch(JSON.stringify({ role: "ADMIN" }))).status).toBe(400);

    mockUpdateUser.mockRejectedValueOnce(new DomainError("LAST_SUPERADMIN", "…", 409));
    expect((await callPatch(JSON.stringify({ role: "ADMIN" }))).status).toBe(409);

    mockUpdateUser.mockRejectedValueOnce(
      new DomainError("SEEDED_SUPERADMIN_CONFIRM_REQUIRED", "…", 409, { requiresConfirmation: "seeded_superadmin" }),
    );
    const res = await callPatch(JSON.stringify({ role: "ADMIN" }));
    expect((await res.json()).error.metadata).toEqual({ requiresConfirmation: "seeded_superadmin" });
  });

  it("422 on invalid body or malformed JSON", async () => {
    expect((await callPatch(JSON.stringify({ role: "OWNER" }))).status).toBe(422);
    expect((await callPatch("{oops")).status).toBe(422);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it("403 for ADMIN even with the «Пользователи» section", async () => {
    mockAuth.mockResolvedValue({ user: { id: "a", role: "ADMIN", adminSections: ["users"] } });
    expect((await callPatch(JSON.stringify({ role: "USER" }))).status).toBe(403);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});
