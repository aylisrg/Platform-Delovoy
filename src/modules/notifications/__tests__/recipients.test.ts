import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    module: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    moduleNotificationRecipient: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import {
  getExplicitRecipientUserIds,
  listEligibleRecipients,
  setRecipientUserIds,
} from "@/modules/notifications/recipients";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
  vi.mocked(prisma.moduleNotificationRecipient.findMany).mockResolvedValue([]);
});

describe("getExplicitRecipientUserIds (ADR 2026-10-25 §Q2)", () => {
  it("reads the table, not Module.config", async () => {
    vi.mocked(prisma.moduleNotificationRecipient.findMany).mockResolvedValue([{ userId: "a" }, { userId: "b" }] as never);
    expect(await getExplicitRecipientUserIds("gazebos")).toEqual(["a", "b"]);
    expect(prisma.moduleNotificationRecipient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { moduleSlug: "gazebos" } }),
    );
    expect(prisma.module.findUnique).not.toHaveBeenCalled();
  });
});

describe("setRecipientUserIds", () => {
  beforeEach(() => {
    vi.mocked(prisma.module.findUnique).mockResolvedValue({ id: "mod-gz" } as never);
  });

  it("admits SUPERADMIN, ADMIN and assigned MANAGER; drops unassigned MANAGER; audits before/after", async () => {
    vi.mocked(prisma.moduleNotificationRecipient.findMany).mockResolvedValue([{ userId: "old" }] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "sa", role: "SUPERADMIN", moduleAssignments: [] },
      { id: "ad", role: "ADMIN", moduleAssignments: [] },
      { id: "m-ok", role: "MANAGER", moduleAssignments: [{ id: "x" }] },
      { id: "m-no", role: "MANAGER", moduleAssignments: [] },
    ] as never);

    const saved = await setRecipientUserIds("gazebos", ["sa", "ad", "m-ok", "m-no", "ghost"], "actor");

    expect(saved).toEqual(["sa", "ad", "m-ok"]);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ mergedIntoUserId: null, role: { in: ["SUPERADMIN", "ADMIN", "MANAGER"] } }),
    }));
    expect(prisma.moduleNotificationRecipient.deleteMany).toHaveBeenCalledWith({ where: { moduleSlug: "gazebos" } });
    expect(prisma.moduleNotificationRecipient.createMany).toHaveBeenCalledWith({
      data: [
        { moduleSlug: "gazebos", userId: "sa", createdByUserId: "actor" },
        { moduleSlug: "gazebos", userId: "ad", createdByUserId: "actor" },
        { moduleSlug: "gazebos", userId: "m-ok", createdByUserId: "actor" },
      ],
      skipDuplicates: true,
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "actor",
        action: "notification.recipients.update",
        metadata: { moduleSlug: "gazebos", before: ["old"], after: ["sa", "ad", "m-ok"] },
      }),
    });
  });

  it("empty list clears the module (group chat takes over again)", async () => {
    await setRecipientUserIds("gazebos", [], "actor");
    expect(prisma.moduleNotificationRecipient.deleteMany).toHaveBeenCalled();
    expect(prisma.moduleNotificationRecipient.createMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("unknown module → MODULE_NOT_FOUND, nothing written", async () => {
    vi.mocked(prisma.module.findUnique).mockResolvedValue(null);
    await expect(setRecipientUserIds("nope", ["a"])).rejects.toThrow("MODULE_NOT_FOUND");
    expect(prisma.moduleNotificationRecipient.deleteMany).not.toHaveBeenCalled();
  });
});

describe("listEligibleRecipients", () => {
  it("isSelected is real membership — SUPERADMIN no longer pre-checked (AC-C3.3)", async () => {
    vi.mocked(prisma.module.findUnique).mockResolvedValue({ assignments: [{ userId: "m1" }] } as never);
    vi.mocked(prisma.moduleNotificationRecipient.findMany).mockResolvedValue([{ userId: "m1" }] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "sa", name: "Суперадмин", email: null, role: "SUPERADMIN", notificationChannels: [] },
      { id: "m1", name: "Менеджер", email: null, role: "MANAGER", notificationChannels: [{ id: "c" }] },
    ] as never);

    const list = await listEligibleRecipients("gazebos");
    expect(list).toEqual([
      expect.objectContaining({ userId: "sa", isSelected: false, hasTelegramChannel: false }),
      expect.objectContaining({ userId: "m1", isSelected: true, hasTelegramChannel: true }),
    ]);
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ mergedIntoUserId: null }),
    }));
  });
});
