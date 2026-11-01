import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findMany: vi.fn() },
    notificationEventPreference: { findMany: vi.fn() },
    moduleNotificationRecipient: { findMany: vi.fn(), count: vi.fn() },
  },
}));
const mockDispatch = vi.fn();
vi.mock("@/modules/notifications/dispatch/dispatcher", () => ({ dispatch: (...a: unknown[]) => mockDispatch(...a) }));
const mockRecordSkips = vi.fn();
vi.mock("@/modules/notifications/skips", () => ({ recordSkips: (...a: unknown[]) => mockRecordSkips(...a) }));

import { prisma } from "@/lib/db";
import { installStaffFixtures, type StaffFixture } from "@/modules/notifications/__tests__/helpers/staff-fixture";
import { dispatchLeadNotification } from "../lead-notify";

let staff: StaffFixture[] = [];
const lead = { taskId: "t1", publicId: "T-42", moduleSlug: "gazebos", title: "Иван", body: "Хочу беседку", reopened: false, created: true };

beforeEach(() => {
  vi.clearAllMocks();
  installStaffFixtures(prisma as never, () => staff);
  mockDispatch.mockResolvedValue({ status: "queued" });
});

describe("dispatchLeadNotification (AC-C3.2, ADR 2026-10-25 §Q7)", () => {
  it("SUPERADMIN + assigned MANAGER get the lead; unassigned and excluded don't", async () => {
    staff = [
      { id: "sa", role: "SUPERADMIN" },
      { id: "m-gz", role: "MANAGER", assignments: ["gazebos"] },
      { id: "m-ps", role: "MANAGER", assignments: ["ps-park"] },
      { id: "ex", role: "USER", assignments: ["gazebos"] },
    ];
    await dispatchLeadNotification(lead);
    expect(mockDispatch.mock.calls.map(([e]) => e.userId).sort()).toEqual(["m-gz", "sa"]);
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "avito.lead.new",
      entityType: "Task",
      entityId: "t1",
      payload: expect.objectContaining({ actions: [{ label: "Открыть задачу", url: expect.stringContaining("/admin/tasks/T-42") }] }),
    }));
  });

  it("explicit «выкл» wins over the role and is recorded as OPTED_OUT", async () => {
    staff = [{ id: "sa", role: "SUPERADMIN", prefs: { "avito.lead.new": false } }];
    await dispatchLeadNotification(lead);
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockRecordSkips).toHaveBeenCalledWith([
      { userId: "sa", eventType: "avito.lead.new", entityType: "Task", entityId: "t1", reason: "OPTED_OUT" },
    ]);
  });

  it("«вкл» adds a personal subscriber with the avito section", async () => {
    staff = [{ id: "m", role: "MANAGER", grants: ["avito"], prefs: { "avito.lead.new": true } }];
    await dispatchLeadNotification({ ...lead, moduleSlug: null });
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ userId: "m" }));
  });

  it("existing chat (not created / reopened) — no extra noise", async () => {
    staff = [{ id: "sa", role: "SUPERADMIN" }];
    await dispatchLeadNotification({ ...lead, created: false, reopened: false });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
