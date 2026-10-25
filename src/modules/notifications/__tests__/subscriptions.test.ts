import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    notificationEventPreference: { findMany: vi.fn(), upsert: vi.fn() },
    moduleNotificationRecipient: { findMany: vi.fn(), count: vi.fn() },
    notificationPreference: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import { setStaffEventSubscription } from "../subscriptions";
import { NotificationDomainError } from "../errors";
import { installStaffFixtures, type StaffFixture } from "./helpers/staff-fixture";

let staff: StaffFixture[] = [];
const actor = { userId: "boss", via: "admin" as const };

beforeEach(() => {
  vi.clearAllMocks();
  staff = [];
  installStaffFixtures(prisma as never, () => staff);
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(prisma)) as never);
});

describe("setStaffEventSubscription (US-C2, ADR 2026-10-25 §5.2)", () => {
  it("AC-C2.1/C2.4: writes the shared preference with the actor and audits before→after in the transaction", async () => {
    staff = [{ id: "m1", role: "MANAGER", grants: ["gazebos"], prefs: { "booking.created": false } }];

    const res = await setStaffEventSubscription({ targetUserId: "m1", eventType: "booking.created", enabled: true, actor });

    expect(res).toEqual({ eventType: "booking.created", enabled: true, before: false });
    expect(prisma.notificationEventPreference.upsert).toHaveBeenCalledWith({
      where: { userId_eventType: { userId: "m1", eventType: "booking.created" } },
      create: { userId: "m1", eventType: "booking.created", enabled: true, updatedByUserId: "boss", updatedVia: "admin" },
      update: { enabled: true, updatedByUserId: "boss", updatedVia: "admin" },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "boss",
        action: "notification.preference.update",
        metadata: { targetUserId: "m1", eventType: "booking.created", before: false, after: true, via: "admin" },
      }),
    });
    expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it("system.release also updates the legacy «Релизы» mirror (AC-C2.8)", async () => {
    staff = [{ id: "m1", role: "MANAGER" }];
    await setStaffEventSubscription({ targetUserId: "m1", eventType: "system.release", enabled: false, actor });
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith({
      where: { userId: "m1" },
      create: { userId: "m1", notifyReleases: false },
      update: { notifyReleases: false },
    });
  });

  it("AC-C2.6: unknown event, outside the catalog → 422, nothing written", async () => {
    await expect(
      setStaffEventSubscription({ targetUserId: "m1", eventType: "messenger.message.received", enabled: true, actor }),
    ).rejects.toMatchObject({ code: "UNKNOWN_EVENT", status: 422 });
    expect(prisma.notificationEventPreference.upsert).not.toHaveBeenCalled();
  });

  it("AC-C2.6: turning on without access → NO_ACCESS_TO_CATEGORY; turning off is always allowed", async () => {
    staff = [{ id: "m1", role: "MANAGER", grants: ["gazebos"] }];
    const err = await setStaffEventSubscription({ targetUserId: "m1", eventType: "order.placed", enabled: true, actor }).catch((e) => e);
    expect(err).toBeInstanceOf(NotificationDomainError);
    expect(err).toMatchObject({ code: "NO_ACCESS_TO_CATEGORY", message: "Нет доступа к разделу «Кафе»" });

    await setStaffEventSubscription({ targetUserId: "m1", eventType: "order.placed", enabled: false, actor });
    expect(prisma.notificationEventPreference.upsert).toHaveBeenCalledTimes(1);
  });

  it("list membership grants access for an ADMIN (the list rule)", async () => {
    staff = [{ id: "a1", role: "ADMIN", lists: ["cafe"] }];
    await expect(
      setStaffEventSubscription({ targetUserId: "a1", eventType: "order.placed", enabled: true, actor }),
    ).resolves.toMatchObject({ enabled: true });
  });

  it("not in the team / merged / missing → domain errors", async () => {
    staff = [{ id: "u", role: "USER" }, { id: "mg", role: "MANAGER", merged: true }];
    await expect(setStaffEventSubscription({ targetUserId: "u", eventType: "system.release", enabled: true, actor })).rejects.toMatchObject({ code: "NOT_IN_TEAM" });
    await expect(setStaffEventSubscription({ targetUserId: "mg", eventType: "system.release", enabled: true, actor })).rejects.toMatchObject({ code: "NOT_IN_TEAM" });
    await expect(setStaffEventSubscription({ targetUserId: "ghost", eventType: "system.release", enabled: true, actor })).rejects.toMatchObject({ code: "USER_NOT_FOUND", status: 404 });
  });
});
