import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({
  prisma: {
    booking: { count: vi.fn(), findMany: vi.fn() },
    resource: { findMany: vi.fn() },
    order: { count: vi.fn(), findMany: vi.fn() },
    feedbackItem: { count: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));
import { prisma } from "@/lib/db";
import {
  bookingWhere,
  getDashboardBookings,
  getDashboardOrders,
  getDashboardFeedback,
} from "../dashboard-service";
const now = new Date("2026-11-11T12:00:00Z");
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.resource.findMany).mockResolvedValue([]);
  vi.mocked(prisma.user.findMany).mockResolvedValue([]);
});
describe("dashboard lists", () => {
  it("keeps future active bookings separate from the 20 newest historical records", async () => {
    vi.mocked(prisma.booking.count).mockResolvedValue(22);
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
    await getDashboardBookings("owner", true, 2, now);
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "owner",
          deletedAt: null,
          OR: [
            { status: { in: ["PENDING", "CONFIRMED"] }, endTime: { gte: now } },
            { status: "CHECKED_IN" },
          ],
        },
        orderBy: [{ startTime: "asc" }, { id: "asc" }],
        take: 10,
        skip: 10,
      }),
    );
  });
  it("history is the complement of upcoming, still scoped to the owner and undeleted records", () => {
    expect(bookingWhere("owner", false, now)).toEqual({
      userId: "owner",
      deletedAt: null,
      NOT: {
        OR: [
          { status: { in: ["PENDING", "CONFIRMED"] }, endTime: { gte: now } },
          { status: "CHECKED_IN" },
        ],
      },
    });
  });
  it("orders omit soft deleted data, paginate, and retain line quantities", async () => {
    vi.mocked(prisma.order.count).mockResolvedValue(11);
    vi.mocked(prisma.order.findMany).mockResolvedValue([
      { id: "order", items: [{ quantity: 3 }, { quantity: 2 }] },
    ] as never);
    const result = await getDashboardOrders("owner", 2);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "owner", deletedAt: null },
        take: 10,
        skip: 10,
      }),
    );
    expect(
      result.orders[0].items.reduce((n, item) => n + item.quantity, 0),
    ).toBe(5);
  });
  it("labels the customer and employee separately without truncating the discussion", async () => {
    const description = "Полное обращение ".repeat(30);
    vi.mocked(prisma.feedbackItem.count).mockResolvedValue(1);
    vi.mocked(prisma.feedbackItem.findMany).mockResolvedValue([
      {
        id: "feedback",
        description,
        comments: [
          { authorId: "owner", text: "Мой ответ" },
          { authorId: "staff", text: "Ответ сотрудника" },
        ],
      },
    ] as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "staff", name: "Мария" },
    ] as never);
    const result = await getDashboardFeedback("owner");
    expect(result.items[0].description).toBe(description);
    expect(result.items[0].comments.map((c) => c.authorLabel)).toEqual([
      "Вы",
      "Мария",
    ]);
  });
});
