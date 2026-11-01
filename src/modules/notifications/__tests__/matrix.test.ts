import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { user: { findMany: vi.fn() } } }));
const mockExplain = vi.fn();
vi.mock("../explain", () => ({ explainStaffNotifications: (...a: unknown[]) => mockExplain(...a) }));

import { prisma } from "@/lib/db";
import { getNotificationMatrix } from "../matrix";

function explain(userId: string, statuses: Record<string, string>, groupChat = false) {
  return {
    userId,
    categories: [
      {
        key: "bookings",
        access: { ok: true },
        groupChat: [{ moduleSlug: "gazebos", moduleLabel: "Барбекю Парк", receives: groupChat }],
        events: Object.entries(statuses).map(([eventType, status]) => ({
          eventType,
          status,
          blockers: status === "BLOCKED" ? [{ code: "NO_CHANNEL", label: "Нет канала доставки" }] : [],
          toggle: { enabled: status === "RECEIVES" || status === "BLOCKED", editable: true },
        })),
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.user.findMany).mockResolvedValue([
    { id: "a", name: "А", role: "SUPERADMIN" },
    { id: "b", name: "Б", role: "MANAGER" },
  ] as never);
});

describe("getNotificationMatrix (US-C4)", () => {
  it("cells from the same explanation; totals and «только общий чат» (AC-C4.3)", async () => {
    mockExplain.mockResolvedValue(new Map([
      ["a", explain("a", { "booking.created": "RECEIVES", "booking.cancelled": "NOT_RECEIVING" }, true)],
      ["b", explain("b", { "booking.created": "BLOCKED", "booking.cancelled": "NOT_RECEIVING" }, true)],
    ]));
    const m = await getNotificationMatrix({ category: "bookings" });
    expect(m.events.map((e) => e.eventType)).toEqual(["booking.created", "booking.cancelled"]);
    expect(m.rows[1].cells["booking.created"]).toEqual({ status: "BLOCKED", reason: "Нет канала доставки", editable: true, enabled: true });
    expect(m.totals["booking.created"]).toEqual({ personalRecipients: 2, groupChatOnly: false });
    expect(m.totals["booking.cancelled"]).toEqual({ personalRecipients: 0, groupChatOnly: true });
  });

  it("«только проблемы» keeps rows with a blocked cell; totals still count the whole team", async () => {
    mockExplain.mockResolvedValue(new Map([
      ["a", explain("a", { "booking.created": "RECEIVES", "booking.cancelled": "RECEIVES" })],
      ["b", explain("b", { "booking.created": "BLOCKED", "booking.cancelled": "NOT_RECEIVING" })],
    ]));
    const m = await getNotificationMatrix({ category: "bookings", problems: true });
    expect(m.rows.map((r) => r.user.id)).toEqual(["b"]);
    expect(m.totals["booking.created"].personalRecipients).toBe(2);
  });

  it("only the current team, never merged or system", async () => {
    mockExplain.mockResolvedValue(new Map());
    await getNotificationMatrix({ role: "MANAGER" });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { role: "MANAGER", mergedIntoUserId: null, id: { not: "system" } },
    }));
  });
});
