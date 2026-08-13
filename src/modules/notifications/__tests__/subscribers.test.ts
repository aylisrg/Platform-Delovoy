import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { notificationEventPreference: { findMany: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import { getSelfSubscribedUserIds } from "../subscribers";

type Row = {
  userId: string;
  user: { role: string; adminPermissions: Array<{ section: string }> } | null;
};

function rows(...items: Row[]) {
  vi.mocked(prisma.notificationEventPreference.findMany).mockResolvedValue(
    items as never
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rows();
});

describe("getSelfSubscribedUserIds", () => {
  it("без требуемых секций не ходит в БД и никого не возвращает", async () => {
    const result = await getSelfSubscribedUserIds("messenger.message.received", []);

    expect(result).toEqual([]);
    expect(prisma.notificationEventPreference.findMany).not.toHaveBeenCalled();
  });

  it("читает только явные включённые строки сотрудников", async () => {
    await getSelfSubscribedUserIds("booking.created", ["gazebos"]);

    expect(prisma.notificationEventPreference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventType: "booking.created",
          enabled: true,
          user: { role: { not: "USER" }, mergedIntoUserId: null },
        }),
      })
    );
  });

  it("пропускает того, у кого есть AdminPermission на нужную секцию", async () => {
    rows({
      userId: "m1",
      user: { role: "MANAGER", adminPermissions: [{ section: "gazebos" }] },
    });

    expect(await getSelfSubscribedUserIds("booking.created", ["gazebos", "ps-park"])).toEqual([
      "m1",
    ]);
  });

  it("отсекает подписчика без доступа к секциям категории", async () => {
    rows({
      userId: "m2",
      user: { role: "MANAGER", adminPermissions: [{ section: "cafe" }] },
    });

    expect(await getSelfSubscribedUserIds("booking.created", ["gazebos", "ps-park"])).toEqual(
      []
    );
  });

  it("SUPERADMIN проходит по роли без грантов", async () => {
    rows({ userId: "s1", user: { role: "SUPERADMIN", adminPermissions: [] } });

    expect(await getSelfSubscribedUserIds("system.release", ["monitoring"])).toEqual([
      "s1",
    ]);
  });

  it("strict-access секция требует явного гранта даже SUPERADMIN", async () => {
    rows({ userId: "s1", user: { role: "SUPERADMIN", adminPermissions: [] } });

    expect(await getSelfSubscribedUserIds("contract.created", ["nedelovoy"])).toEqual([]);
  });

  it("strict-access секция открывается SUPERADMIN с грантом", async () => {
    rows({
      userId: "s1",
      user: { role: "SUPERADMIN", adminPermissions: [{ section: "nedelovoy" }] },
    });

    expect(await getSelfSubscribedUserIds("contract.created", ["nedelovoy"])).toEqual([
      "s1",
    ]);
  });

  it("ADMIN проверяется теми же правилами, что MANAGER", async () => {
    rows(
      { userId: "a1", user: { role: "ADMIN", adminPermissions: [{ section: "cafe" }] } },
      { userId: "a2", user: { role: "ADMIN", adminPermissions: [] } }
    );

    expect(await getSelfSubscribedUserIds("order.placed", ["cafe"])).toEqual(["a1"]);
  });
});
