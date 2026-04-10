import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
    },
    order: {
      findMany: vi.fn(),
    },
    resource: {
      findMany: vi.fn(),
    },
  },
}));

import {
  listClients,
  getClientDetail,
  getClientStats,
  calculateBookingCost,
} from "@/modules/clients/service";
import { prisma } from "@/lib/db";

const mockDate = (str: string) => new Date(str);

const mockResource = (id: string, pricePerHour: number) => ({
  id,
  pricePerHour,
});

const mockBooking = (overrides = {}) => ({
  id: "booking-1",
  moduleSlug: "gazebos",
  resourceId: "res-1",
  date: mockDate("2026-03-10"),
  startTime: mockDate("2026-03-10T10:00:00Z"),
  endTime: mockDate("2026-03-10T12:00:00Z"),
  status: "COMPLETED",
  createdAt: mockDate("2026-03-10T09:00:00Z"),
  ...overrides,
});

const mockOrder = (overrides = {}) => ({
  id: "order-1",
  moduleSlug: "cafe",
  status: "DELIVERED",
  totalAmount: 500,
  deliveryTo: "305",
  createdAt: mockDate("2026-03-15T12:00:00Z"),
  items: [{ id: "item-1" }],
  ...overrides,
});

const mockUser = (overrides = {}) => ({
  id: "user-1",
  name: "Иван Петров",
  email: "ivan@test.com",
  phone: "+79001234567",
  image: null,
  telegramId: null,
  vkId: null,
  createdAt: mockDate("2026-01-15"),
  bookings: [mockBooking()],
  orders: [mockOrder()],
  ...overrides,
});

describe("calculateBookingCost", () => {
  it("calculates cost for 2-hour booking at 1000/hour", () => {
    const result = calculateBookingCost(
      mockDate("2026-03-10T10:00:00Z"),
      mockDate("2026-03-10T12:00:00Z"),
      1000
    );
    expect(result).toBe(2000);
  });

  it("calculates cost for 1.5-hour booking", () => {
    const result = calculateBookingCost(
      mockDate("2026-03-10T10:00:00Z"),
      mockDate("2026-03-10T11:30:00Z"),
      1000
    );
    expect(result).toBe(1500);
  });

  it("returns 0 when pricePerHour is null", () => {
    const result = calculateBookingCost(
      mockDate("2026-03-10T10:00:00Z"),
      mockDate("2026-03-10T12:00:00Z"),
      null
    );
    expect(result).toBe(0);
  });

  it("returns 0 when pricePerHour is 0", () => {
    const result = calculateBookingCost(
      mockDate("2026-03-10T10:00:00Z"),
      mockDate("2026-03-10T12:00:00Z"),
      0
    );
    expect(result).toBe(0);
  });
});

describe("listClients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns aggregated client list", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([mockUser()] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(1 as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      mockResource("res-1", 1000),
    ] as never);

    const result = await listClients();

    expect(result.total).toBe(1);
    expect(result.clients).toHaveLength(1);

    const client = result.clients[0];
    expect(client.id).toBe("user-1");
    expect(client.name).toBe("Иван Петров");
    expect(client.bookingCount).toBe(1);
    expect(client.orderCount).toBe(1);
    // 2 hours * 1000/hour + 500 order = 2500
    expect(client.totalSpent).toBe(2500);
    expect(client.modulesUsed).toHaveLength(2);
  });

  it("filters by search query", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);

    await listClients({ search: "Иван" });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "USER",
          OR: expect.arrayContaining([
            { name: { contains: "Иван", mode: "insensitive" } },
          ]),
        }),
      })
    );
  });

  it("filters by booking module", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);

    await listClients({ moduleSlug: "gazebos" });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookings: { some: { moduleSlug: "gazebos" } },
        }),
      })
    );
  });

  it("filters by order module", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);

    await listClients({ moduleSlug: "cafe" });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orders: { some: { moduleSlug: "cafe" } },
        }),
      })
    );
  });

  it("sorts by totalSpent", async () => {
    const user1 = mockUser({
      id: "user-1",
      orders: [mockOrder({ totalAmount: 100 })],
      bookings: [],
    });
    const user2 = mockUser({
      id: "user-2",
      orders: [mockOrder({ totalAmount: 500 })],
      bookings: [],
    });
    vi.mocked(prisma.user.findMany).mockResolvedValue([user1, user2] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(2 as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);

    const result = await listClients({
      sortBy: "totalSpent",
      sortOrder: "desc",
    });

    expect(result.clients[0].totalSpent).toBeGreaterThanOrEqual(
      result.clients[1].totalSpent
    );
  });

  it("paginates results", async () => {
    const users = Array.from({ length: 5 }, (_, i) =>
      mockUser({ id: `user-${i}`, bookings: [], orders: [] })
    );
    vi.mocked(prisma.user.findMany).mockResolvedValue(users as never);
    vi.mocked(prisma.user.count).mockResolvedValue(5 as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);

    const result = await listClients({ limit: 2, offset: 1 });

    expect(result.clients).toHaveLength(2);
    expect(result.total).toBe(5);
  });

  it("only counts COMPLETED bookings and DELIVERED orders as spent", async () => {
    const user = mockUser({
      bookings: [
        mockBooking({ status: "PENDING" }),
        mockBooking({ id: "b2", status: "CANCELLED" }),
      ],
      orders: [
        mockOrder({ status: "NEW", totalAmount: 300 }),
        mockOrder({ id: "o2", status: "CANCELLED", totalAmount: 200 }),
      ],
    });
    vi.mocked(prisma.user.findMany).mockResolvedValue([user] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(1 as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      mockResource("res-1", 1000),
    ] as never);

    const result = await listClients();
    expect(result.clients[0].totalSpent).toBe(0);
  });
});

describe("getClientDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns full client profile", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser() as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      { id: "res-1", name: "Беседка №1", pricePerHour: 1000 },
    ] as never);

    const result = await getClientDetail("user-1");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("user-1");
    expect(result!.bookings).toHaveLength(1);
    expect(result!.orders).toHaveLength(1);
    expect(result!.activityTimeline).toHaveLength(2);
    // 2h * 1000 + 500 = 2500
    expect(result!.totalSpent).toBe(2500);
    expect(result!.bookings[0].resourceName).toBe("Беседка №1");
    expect(result!.bookings[0].amount).toBe(2000);
  });

  it("returns null for non-existent user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const result = await getClientDetail("nonexistent");
    expect(result).toBeNull();
  });

  it("builds monthly spending correctly", async () => {
    const user = mockUser({
      bookings: [
        mockBooking({ createdAt: mockDate("2026-01-15T10:00:00Z") }),
        mockBooking({
          id: "b2",
          createdAt: mockDate("2026-02-15T10:00:00Z"),
        }),
      ],
      orders: [
        mockOrder({ createdAt: mockDate("2026-01-20T12:00:00Z") }),
      ],
    });
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      { id: "res-1", name: "Беседка №1", pricePerHour: 1000 },
    ] as never);

    const result = await getClientDetail("user-1");

    expect(result!.spendingByMonth).toHaveLength(2);
    const jan = result!.spendingByMonth.find((m) => m.month === "2026-01");
    expect(jan).toBeDefined();
    expect(jan!.bookingsSpent).toBe(2000);
    expect(jan!.ordersSpent).toBe(500);
    expect(jan!.total).toBe(2500);
  });

  it("sorts activity timeline newest-first", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser() as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      { id: "res-1", name: "Беседка №1", pricePerHour: 1000 },
    ] as never);

    const result = await getClientDetail("user-1");
    const dates = result!.activityTimeline.map((e) =>
      new Date(e.createdAt).getTime()
    );
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });
});

describe("getClientStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns aggregate stats", async () => {
    vi.mocked(prisma.user.count)
      .mockResolvedValueOnce(100 as never) // totalClients
      .mockResolvedValueOnce(10 as never) // newThisMonth
      .mockResolvedValueOnce(3 as never); // newThisWeek

    vi.mocked(prisma.booking.findMany)
      .mockResolvedValueOnce([{ userId: "u1" }, { userId: "u2" }] as never) // activeBookers
      .mockResolvedValueOnce([{ userId: "u1" }] as never) // gazeboUsers
      .mockResolvedValueOnce([{ userId: "u2" }] as never); // psParkUsers

    vi.mocked(prisma.order.findMany)
      .mockResolvedValueOnce([{ userId: "u1" }] as never) // activeOrderers
      .mockResolvedValueOnce([{ userId: "u1" }, { userId: "u3" }] as never); // cafeUsers

    // usersWithActivity for top spenders
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      {
        id: "u1",
        name: "Топ спендер",
        bookings: [],
        orders: [{ totalAmount: 5000 }],
      },
    ] as never);

    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);

    const result = await getClientStats();

    expect(result.totalClients).toBe(100);
    expect(result.newThisMonth).toBe(10);
    expect(result.newThisWeek).toBe(3);
    expect(result.activeThisMonth).toBe(2); // u1, u2 unique
    expect(result.topSpenders).toHaveLength(1);
    expect(result.topSpenders[0].totalSpent).toBe(5000);
    expect(result.moduleBreakdown).toHaveLength(3);
  });
});
