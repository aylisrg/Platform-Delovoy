import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockDeleteUser = vi.fn();
vi.mock("@/modules/users/service", () => ({
  deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
  updateUser: vi.fn(),
  getUser: vi.fn(),
}));

import { DELETE } from "../route";

const call = () =>
  DELETE(new Request("http://localhost/api/users/user-1", { method: "DELETE" }), {
    params: Promise.resolve({ id: "user-1" }),
  });

describe("DELETE /api/users/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "SUPERADMIN" } });
  });

  it("200 when user (with bookings) is deleted", async () => {
    mockDeleteUser.mockResolvedValue(undefined);
    const res = await call();
    expect(res.status).toBe(200);
  });

  it("409 with clear message when user has a subscription", async () => {
    mockDeleteUser.mockRejectedValue(new Error("USER_HAS_SUBSCRIPTIONS"));
    const res = await call();
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(JSON.stringify(body)).toContain("USER_HAS_SUBSCRIPTIONS");
    expect(JSON.stringify(body)).toContain("подписк");
  });

  it("409 on other FK dependencies", async () => {
    mockDeleteUser.mockRejectedValue(new Error("USER_HAS_DEPENDENCIES"));
    const res = await call();
    expect(res.status).toBe(409);
  });

  it("500 on unknown errors", async () => {
    mockDeleteUser.mockRejectedValue(new Error("boom"));
    const res = await call();
    expect(res.status).toBe(500);
  });

  it("403 for non-superadmin", async () => {
    mockAuth.mockResolvedValue({ user: { id: "m", role: "MANAGER" } });
    const res = await call();
    expect(res.status).toBe(403);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });
});
