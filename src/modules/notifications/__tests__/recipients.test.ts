import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    module: { findUnique: vi.fn(), update: vi.fn() },
    moduleAssignment: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import {
  getRecipientUserIds,
  setRecipientUserIds,
  listEligibleRecipients,
} from "@/modules/notifications/recipients";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRecipientUserIds", () => {
  it("always includes all SUPERADMIN users", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "sa-1" }] as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue(null);

    const ids = await getRecipientUserIds("rental");

    expect(ids).toContain("sa-1");
  });

  it("merges notificationRecipients from Module.config with superadmins", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "sa-1" }] as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { notificationRecipients: ["mgr-1", "mgr-2"] },
    } as never);

    const ids = await getRecipientUserIds("rental");

    expect(ids).toContain("sa-1");
    expect(ids).toContain("mgr-1");
    expect(ids).toContain("mgr-2");
  });

  it("deduplicates when a superadmin is also in notificationRecipients", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "sa-1" }] as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { notificationRecipients: ["sa-1", "mgr-1"] },
    } as never);

    const ids = await getRecipientUserIds("rental");

    expect(ids.filter((id) => id === "sa-1")).toHaveLength(1);
  });
});

describe("setRecipientUserIds", () => {
  it("rejects USER-role entries", async () => {
    // findMany returns empty → no valid users with ADMIN/MANAGER role
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({ config: {} } as never);
    vi.mocked(prisma.module.update).mockResolvedValue({} as never);

    await setRecipientUserIds("rental", ["user-1"]);

    const call = vi.mocked(prisma.module.update).mock.calls[0][0];
    expect((call.data.config as { notificationRecipients: string[] }).notificationRecipients).toEqual([]);
  });

  it("rejects MANAGER without ModuleAssignment", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "mgr-1", role: "MANAGER" },
    ] as never);
    vi.mocked(prisma.module.findUnique)
      .mockResolvedValueOnce({ config: {} } as never) // setRecipientUserIds lookup
      .mockResolvedValueOnce({ id: "mod-1" } as never); // module id lookup
    vi.mocked(prisma.moduleAssignment.findMany).mockResolvedValue([] as never); // no assignment
    vi.mocked(prisma.module.update).mockResolvedValue({} as never);

    await setRecipientUserIds("rental", ["mgr-1"]);

    const call = vi.mocked(prisma.module.update).mock.calls[0][0];
    expect((call.data.config as { notificationRecipients: string[] }).notificationRecipients).toEqual([]);
  });

  it("accepts MANAGER with ModuleAssignment", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "mgr-1", role: "MANAGER" },
    ] as never);
    vi.mocked(prisma.module.findUnique)
      .mockResolvedValueOnce({ config: {} } as never)
      .mockResolvedValueOnce({ id: "mod-1" } as never);
    vi.mocked(prisma.moduleAssignment.findMany).mockResolvedValue([
      { userId: "mgr-1" },
    ] as never);
    vi.mocked(prisma.module.update).mockResolvedValue({} as never);

    await setRecipientUserIds("rental", ["mgr-1"]);

    const call = vi.mocked(prisma.module.update).mock.calls[0][0];
    expect((call.data.config as { notificationRecipients: string[] }).notificationRecipients).toContain("mgr-1");
  });

  it("preserves existing config keys when updating", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      config: { telegramAdminChatId: "12345", notificationRecipients: [] },
    } as never);
    vi.mocked(prisma.module.update).mockResolvedValue({} as never);

    await setRecipientUserIds("rental", []);

    const call = vi.mocked(prisma.module.update).mock.calls[0][0];
    expect((call.data.config as Record<string, unknown>).telegramAdminChatId).toBe("12345");
  });
});

describe("listEligibleRecipients", () => {
  it("marks SUPERADMIN as always selected", async () => {
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      id: "mod-1",
      config: { notificationRecipients: [] },
      assignments: [],
    } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "sa-1", name: "Admin", email: "a@a.com", role: "SUPERADMIN", notificationChannels: [] },
    ] as never);

    const result = await listEligibleRecipients("rental");

    expect(result[0].isSelected).toBe(true);
    expect(result[0].role).toBe("SUPERADMIN");
  });

  it("marks non-SUPERADMIN as selected only if in notificationRecipients", async () => {
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      id: "mod-1",
      config: { notificationRecipients: ["mgr-1"] },
      assignments: [{ userId: "mgr-1" }],
    } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "mgr-1", name: "Mgr", email: "m@m.com", role: "MANAGER", notificationChannels: [] },
      { id: "mgr-2", name: "Mgr2", email: "m2@m.com", role: "MANAGER", notificationChannels: [] },
    ] as never);

    const result = await listEligibleRecipients("rental");

    const mgr1 = result.find((r) => r.userId === "mgr-1");
    const mgr2 = result.find((r) => r.userId === "mgr-2");
    expect(mgr1?.isSelected).toBe(true);
    expect(mgr2?.isSelected).toBe(false);
  });

  it("reports hasTelegramChannel=true when TELEGRAM channel is active", async () => {
    vi.mocked(prisma.module.findUnique).mockResolvedValue({
      id: "mod-1",
      config: {},
      assignments: [],
    } as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "sa-1",
        name: "Admin",
        email: "a@a.com",
        role: "SUPERADMIN",
        notificationChannels: [{ id: "ch-1" }],
      },
    ] as never);

    const result = await listEligibleRecipients("rental");

    expect(result[0].hasTelegramChannel).toBe(true);
  });
});
