import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
    },
  },
}));

const { canAccessTask, isAdmin } = await import("../access");
const { prisma } = await import("@/lib/db");

const findUnique = prisma.task.findUnique as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => findUnique.mockReset());

describe("isAdmin", () => {
  it("true for SUPERADMIN/ADMIN", () => {
    expect(isAdmin("SUPERADMIN" as Role)).toBe(true);
    expect(isAdmin("ADMIN" as Role)).toBe(true);
  });
  it("false otherwise", () => {
    expect(isAdmin("MANAGER" as Role)).toBe(false);
    expect(isAdmin("USER" as Role)).toBe(false);
  });
});

describe("canAccessTask", () => {
  it("ADMIN passes everything", async () => {
    findUnique.mockResolvedValue({
      reporterUserId: null,
      assignees: [],
    });
    expect(await canAccessTask("u1", "ADMIN", "t1", "delete")).toBe(true);
    expect(await canAccessTask("u1", "ADMIN", "t1", "manage")).toBe(true);
  });

  it("returns false when task missing", async () => {
    findUnique.mockResolvedValue(null);
    expect(await canAccessTask("u1", "USER", "t1", "read")).toBe(false);
  });

  it("non-admin can read if assignee", async () => {
    findUnique.mockResolvedValue({
      reporterUserId: null,
      assignees: [{ userId: "u1", role: "COLLABORATOR" }],
    });
    expect(await canAccessTask("u1", "USER", "t1", "read")).toBe(true);
    expect(await canAccessTask("u1", "USER", "t1", "write")).toBe(true);
  });

  it("non-admin can read if reporter", async () => {
    findUnique.mockResolvedValue({
      reporterUserId: "u1",
      assignees: [],
    });
    expect(await canAccessTask("u1", "USER", "t1", "read")).toBe(true);
  });

  it("non-admin cannot delete or manage if not RESPONSIBLE", async () => {
    findUnique.mockResolvedValue({
      reporterUserId: null,
      assignees: [{ userId: "u1", role: "COLLABORATOR" }],
    });
    expect(await canAccessTask("u1", "USER", "t1", "delete")).toBe(false);
    expect(await canAccessTask("u1", "USER", "t1", "manage")).toBe(false);
  });

  it("non-admin can manage when RESPONSIBLE", async () => {
    findUnique.mockResolvedValue({
      reporterUserId: null,
      assignees: [{ userId: "u1", role: "RESPONSIBLE" }],
    });
    expect(await canAccessTask("u1", "USER", "t1", "manage")).toBe(true);
  });

  it("MANAGER not assignee gets no access", async () => {
    findUnique.mockResolvedValue({
      reporterUserId: null,
      assignees: [{ userId: "other", role: "RESPONSIBLE" }],
    });
    expect(await canAccessTask("u1", "MANAGER", "t1", "read")).toBe(false);
    expect(await canAccessTask("u1", "MANAGER", "t1", "write")).toBe(false);
  });
});
