import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    notificationEventPreference: { findMany: vi.fn() },
    moduleNotificationRecipient: { findMany: vi.fn(), count: vi.fn() },
  },
}));

const mockGetUserAdminSections = vi.fn();
vi.mock("@/lib/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions")>()),
  getUserAdminSections: (...args: unknown[]) => mockGetUserAdminSections(...args),
}));

import { prisma } from "@/lib/db";
import { installStaffFixtures, type StaffFixture } from "@/modules/notifications/__tests__/helpers/staff-fixture";
import { getWebAppCapabilities, resolveManagedCategories } from "../capabilities";

let staff: StaffFixture[] = [];
const keys = async (fixture: StaffFixture) => {
  staff = [fixture];
  return (await resolveManagedCategories({ id: fixture.id, role: fixture.role })).map((c) => c.key);
};

beforeEach(() => {
  vi.clearAllMocks();
  staff = [];
  installStaffFixtures(prisma as never, () => staff);
});

describe("getWebAppCapabilities", () => {
  it("USER: гостевые capabilities без единого запроса в БД", async () => {
    const caps = await getWebAppCapabilities({ id: "u1", role: "USER" });
    expect(caps).toEqual({
      isStaff: false,
      staffSections: [],
      notificationCategories: [],
      canNotificationCenter: false,
    });
    expect(mockGetUserAdminSections).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("MANAGER с секцией gazebos: bookings + системные, Центр доступен", async () => {
    staff = [{ id: "u1", role: "MANAGER", grants: ["gazebos"] }];
    mockGetUserAdminSections.mockResolvedValue(["gazebos"]);
    const caps = await getWebAppCapabilities({ id: "u1", role: "MANAGER" });
    expect(caps.isStaff).toBe(true);
    expect(caps.staffSections).toEqual(["gazebos"]);
    expect(caps.notificationCategories).toEqual(["bookings", "system"]);
    expect(caps.canNotificationCenter).toBe(true);
  });

  it("staffSections — passthrough из getUserAdminSections (strict-access учтён там)", async () => {
    staff = [{ id: "sa", role: "SUPERADMIN" }];
    mockGetUserAdminSections.mockResolvedValue(["gazebos", "monitoring"]);
    const caps = await getWebAppCapabilities({ id: "sa", role: "SUPERADMIN" });
    expect(caps.staffSections).not.toContain("nedelovoy");
  });
});

// Same access rule as the delivery (ADR 2026-10-25-team-access-notifications §Q7).
describe("resolveManagedCategories", () => {
  it("SUPERADMIN видит всё, включая звонки и системные", async () => {
    expect(await keys({ id: "sa", role: "SUPERADMIN" })).toEqual([
      "telephony", "bookings", "cafe", "rental", "payments", "avito", "system",
    ]);
  });

  it("системные (релизы) доступны любому сотруднику — как и реальная доставка релизов", async () => {
    expect(await keys({ id: "m1", role: "MANAGER", grants: ["cafe"] })).toEqual(["cafe", "system"]);
  });

  it("ADMIN без явных грантов видит бронирования по роли (AC-C3.4)", async () => {
    expect(await keys({ id: "a", role: "ADMIN" })).toEqual(["bookings", "system"]);
  });

  it("назначение на модуль открывает категорию без секции (как список получателей и Авито)", async () => {
    expect(await keys({ id: "m", role: "MANAGER", assignments: ["cafe"] })).toEqual(["cafe", "payments", "system"]);
  });

  it("без доступа категория не видна даже при старой строке подписки (grandfather убран)", async () => {
    expect(await keys({ id: "m", role: "MANAGER", grants: ["cafe"], prefs: { "booking.created": true } })).toEqual([
      "cafe",
      "system",
    ]);
  });

  it("звонки — только суперадмину, даже с грантом раздела", async () => {
    expect(await keys({ id: "m", role: "MANAGER", grants: ["telephony"] })).not.toContain("telephony");
  });

  it("исключённый / влитый — ничего", async () => {
    expect(await resolveManagedCategories({ id: "x", role: "USER" })).toEqual([]);
    expect(await keys({ id: "y", role: "MANAGER", grants: ["cafe"], merged: true })).toEqual([]);
  });
});
