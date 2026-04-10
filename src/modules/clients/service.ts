import { prisma } from "@/lib/db";
import type {
  ClientSummary,
  ClientDetail,
  ClientStats,
  ClientBooking,
  ClientOrder,
  ActivityEvent,
  MonthlySpending,
  ModuleUsage,
} from "./types";
import type { ClientFilterInput } from "./validation";

const MODULE_NAMES: Record<string, string> = {
  gazebos: "Беседки",
  "ps-park": "PS Park",
  cafe: "Кафе",
};

const BOOKING_MODULES = ["gazebos", "ps-park"] as const;
const ORDER_MODULES = ["cafe"] as const;

export function calculateBookingCost(
  startTime: Date,
  endTime: Date,
  pricePerHour: number | null
): number {
  if (!pricePerHour || pricePerHour <= 0) return 0;
  const durationHours =
    (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
  return Math.round(durationHours * pricePerHour * 100) / 100;
}

export async function listClients(
  filter: ClientFilterInput = {}
): Promise<{ clients: ClientSummary[]; total: number }> {
  const {
    search,
    moduleSlug,
    sortBy = "createdAt",
    sortOrder = "desc",
    limit = 50,
    offset = 0,
  } = filter;

  // Build user WHERE clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userWhere: any = { role: "USER" as const };

  if (search) {
    userWhere.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
    ];
  }

  if (moduleSlug) {
    const isBookingModule = (BOOKING_MODULES as readonly string[]).includes(
      moduleSlug
    );
    const isOrderModule = (ORDER_MODULES as readonly string[]).includes(
      moduleSlug
    );

    if (isBookingModule) {
      userWhere.bookings = { some: { moduleSlug } };
    } else if (isOrderModule) {
      userWhere.orders = { some: { moduleSlug } };
    }
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        image: true,
        telegramId: true,
        vkId: true,
        createdAt: true,
        bookings: {
          select: {
            id: true,
            moduleSlug: true,
            status: true,
            startTime: true,
            endTime: true,
            resourceId: true,
            createdAt: true,
          },
        },
        orders: {
          select: {
            id: true,
            moduleSlug: true,
            status: true,
            totalAmount: true,
            createdAt: true,
          },
        },
      },
    }),
    prisma.user.count({ where: userWhere }),
  ]);

  // Fetch resource prices for booking cost calculation
  const resources = await prisma.resource.findMany({
    select: { id: true, pricePerHour: true },
  });
  const priceMap = new Map(
    resources.map((r) => [r.id, Number(r.pricePerHour ?? 0)])
  );

  // Aggregate per user
  const clients: ClientSummary[] = users.map((user) => {
    const modulesMap = new Map<
      string,
      { firstUsedAt: Date; count: number; totalSpent: number }
    >();

    let totalSpent = 0;

    // Process bookings
    for (const booking of user.bookings) {
      const cost =
        booking.status === "COMPLETED"
          ? calculateBookingCost(
              booking.startTime,
              booking.endTime,
              priceMap.get(booking.resourceId) ?? null
            )
          : 0;

      totalSpent += cost;

      const existing = modulesMap.get(booking.moduleSlug);
      if (existing) {
        existing.count++;
        existing.totalSpent += cost;
        if (booking.createdAt < existing.firstUsedAt) {
          existing.firstUsedAt = booking.createdAt;
        }
      } else {
        modulesMap.set(booking.moduleSlug, {
          firstUsedAt: booking.createdAt,
          count: 1,
          totalSpent: cost,
        });
      }
    }

    // Process orders
    for (const order of user.orders) {
      const cost =
        order.status === "DELIVERED" ? Number(order.totalAmount) : 0;
      totalSpent += cost;

      const existing = modulesMap.get(order.moduleSlug);
      if (existing) {
        existing.count++;
        existing.totalSpent += cost;
        if (order.createdAt < existing.firstUsedAt) {
          existing.firstUsedAt = order.createdAt;
        }
      } else {
        modulesMap.set(order.moduleSlug, {
          firstUsedAt: order.createdAt,
          count: 1,
          totalSpent: cost,
        });
      }
    }

    const modulesUsed: ModuleUsage[] = Array.from(modulesMap.entries()).map(
      ([slug, data]) => ({
        moduleSlug: slug,
        moduleName: MODULE_NAMES[slug] || slug,
        firstUsedAt: data.firstUsedAt.toISOString(),
        count: data.count,
        totalSpent: Math.round(data.totalSpent * 100) / 100,
      })
    );

    // Find last activity
    const allDates = [
      ...user.bookings.map((b) => b.createdAt),
      ...user.orders.map((o) => o.createdAt),
    ];
    const lastActivityAt =
      allDates.length > 0
        ? new Date(
            Math.max(...allDates.map((d) => d.getTime()))
          ).toISOString()
        : null;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      image: user.image,
      telegramId: user.telegramId,
      vkId: user.vkId,
      createdAt: user.createdAt.toISOString(),
      modulesUsed,
      totalSpent: Math.round(totalSpent * 100) / 100,
      bookingCount: user.bookings.length,
      orderCount: user.orders.length,
      lastActivityAt,
    };
  });

  // Sort by computed fields
  clients.sort((a, b) => {
    const dir = sortOrder === "asc" ? 1 : -1;
    switch (sortBy) {
      case "totalSpent":
        return (a.totalSpent - b.totalSpent) * dir;
      case "lastActivity": {
        const aTime = a.lastActivityAt
          ? new Date(a.lastActivityAt).getTime()
          : 0;
        const bTime = b.lastActivityAt
          ? new Date(b.lastActivityAt).getTime()
          : 0;
        return (aTime - bTime) * dir;
      }
      case "name":
        return (a.name ?? "").localeCompare(b.name ?? "", "ru") * dir;
      case "createdAt":
      default:
        return (
          (new Date(a.createdAt).getTime() -
            new Date(b.createdAt).getTime()) *
          dir
        );
    }
  });

  return {
    clients: clients.slice(offset, offset + limit),
    total,
  };
}

export async function getClientDetail(
  userId: string
): Promise<ClientDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId, role: "USER" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      image: true,
      telegramId: true,
      vkId: true,
      createdAt: true,
      bookings: {
        select: {
          id: true,
          moduleSlug: true,
          resourceId: true,
          date: true,
          startTime: true,
          endTime: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
      orders: {
        select: {
          id: true,
          moduleSlug: true,
          status: true,
          totalAmount: true,
          deliveryTo: true,
          createdAt: true,
          items: { select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!user) return null;

  // Fetch resource info for bookings
  const resourceIds = [...new Set(user.bookings.map((b) => b.resourceId))];
  const resources = await prisma.resource.findMany({
    where: { id: { in: resourceIds } },
    select: { id: true, name: true, pricePerHour: true },
  });
  const resourceMap = new Map(resources.map((r) => [r.id, r]));

  // Build module usage map
  const modulesMap = new Map<
    string,
    { firstUsedAt: Date; count: number; totalSpent: number }
  >();
  let totalSpent = 0;

  // Build bookings with calculated amounts
  const bookings: ClientBooking[] = user.bookings.map((b) => {
    const resource = resourceMap.get(b.resourceId);
    const pricePerHour = resource ? Number(resource.pricePerHour ?? 0) : 0;
    const amount =
      b.status === "COMPLETED"
        ? calculateBookingCost(b.startTime, b.endTime, pricePerHour)
        : 0;
    totalSpent += amount;

    // Track module usage
    const existing = modulesMap.get(b.moduleSlug);
    if (existing) {
      existing.count++;
      existing.totalSpent += amount;
      if (b.createdAt < existing.firstUsedAt)
        existing.firstUsedAt = b.createdAt;
    } else {
      modulesMap.set(b.moduleSlug, {
        firstUsedAt: b.createdAt,
        count: 1,
        totalSpent: amount,
      });
    }

    return {
      id: b.id,
      moduleSlug: b.moduleSlug,
      resourceName: resource?.name ?? "Неизвестный ресурс",
      date: b.date.toISOString(),
      startTime: b.startTime.toISOString(),
      endTime: b.endTime.toISOString(),
      status: b.status,
      amount,
      createdAt: b.createdAt.toISOString(),
    };
  });

  // Build orders
  const orders: ClientOrder[] = user.orders.map((o) => {
    const amount = o.status === "DELIVERED" ? Number(o.totalAmount) : 0;
    totalSpent += amount;

    const existing = modulesMap.get(o.moduleSlug);
    if (existing) {
      existing.count++;
      existing.totalSpent += amount;
      if (o.createdAt < existing.firstUsedAt)
        existing.firstUsedAt = o.createdAt;
    } else {
      modulesMap.set(o.moduleSlug, {
        firstUsedAt: o.createdAt,
        count: 1,
        totalSpent: amount,
      });
    }

    return {
      id: o.id,
      moduleSlug: o.moduleSlug,
      status: o.status,
      totalAmount: Number(o.totalAmount),
      itemCount: o.items.length,
      deliveryTo: o.deliveryTo,
      createdAt: o.createdAt.toISOString(),
    };
  });

  const modulesUsed: ModuleUsage[] = Array.from(modulesMap.entries()).map(
    ([slug, data]) => ({
      moduleSlug: slug,
      moduleName: MODULE_NAMES[slug] || slug,
      firstUsedAt: data.firstUsedAt.toISOString(),
      count: data.count,
      totalSpent: Math.round(data.totalSpent * 100) / 100,
    })
  );

  // Build activity timeline
  const activityTimeline: ActivityEvent[] = [
    ...user.bookings.map((b) => {
      const resource = resourceMap.get(b.resourceId);
      const amount =
        b.status === "COMPLETED"
          ? calculateBookingCost(
              b.startTime,
              b.endTime,
              resource ? Number(resource.pricePerHour ?? 0) : 0
            )
          : null;
      return {
        id: b.id,
        type: "booking" as const,
        moduleSlug: b.moduleSlug,
        action: `booking.${b.status.toLowerCase()}`,
        description: `${MODULE_NAMES[b.moduleSlug] || b.moduleSlug}: ${resource?.name ?? "Ресурс"}`,
        amount,
        createdAt: b.createdAt.toISOString(),
      };
    }),
    ...user.orders.map((o) => ({
      id: o.id,
      type: "order" as const,
      moduleSlug: o.moduleSlug,
      action: `order.${o.status.toLowerCase()}`,
      description: `${MODULE_NAMES[o.moduleSlug] || o.moduleSlug}: ${o.items.length} позиц.`,
      amount: Number(o.totalAmount),
      createdAt: o.createdAt.toISOString(),
    })),
  ].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Build monthly spending
  const monthlyMap = new Map<
    string,
    { bookingsSpent: number; ordersSpent: number }
  >();

  for (const b of user.bookings) {
    if (b.status !== "COMPLETED") continue;
    const resource = resourceMap.get(b.resourceId);
    const cost = calculateBookingCost(
      b.startTime,
      b.endTime,
      resource ? Number(resource.pricePerHour ?? 0) : 0
    );
    const month = b.createdAt.toISOString().slice(0, 7);
    const entry = monthlyMap.get(month) ?? {
      bookingsSpent: 0,
      ordersSpent: 0,
    };
    entry.bookingsSpent += cost;
    monthlyMap.set(month, entry);
  }

  for (const o of user.orders) {
    if (o.status !== "DELIVERED") continue;
    const month = o.createdAt.toISOString().slice(0, 7);
    const entry = monthlyMap.get(month) ?? {
      bookingsSpent: 0,
      ordersSpent: 0,
    };
    entry.ordersSpent += Number(o.totalAmount);
    monthlyMap.set(month, entry);
  }

  const spendingByMonth: MonthlySpending[] = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      bookingsSpent: Math.round(data.bookingsSpent * 100) / 100,
      ordersSpent: Math.round(data.ordersSpent * 100) / 100,
      total:
        Math.round((data.bookingsSpent + data.ordersSpent) * 100) / 100,
    }));

  // Find last activity
  const allDates = [
    ...user.bookings.map((b) => b.createdAt),
    ...user.orders.map((o) => o.createdAt),
  ];
  const lastActivityAt =
    allDates.length > 0
      ? new Date(
          Math.max(...allDates.map((d) => d.getTime()))
        ).toISOString()
      : null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    image: user.image,
    telegramId: user.telegramId,
    vkId: user.vkId,
    createdAt: user.createdAt.toISOString(),
    modulesUsed,
    totalSpent: Math.round(totalSpent * 100) / 100,
    bookingCount: user.bookings.length,
    orderCount: user.orders.length,
    lastActivityAt,
    bookings,
    orders,
    activityTimeline,
    spendingByMonth,
  };
}

export async function getClientStats(): Promise<ClientStats> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  const [totalClients, newThisMonth, newThisWeek] = await Promise.all([
    prisma.user.count({ where: { role: "USER" } }),
    prisma.user.count({
      where: { role: "USER", createdAt: { gte: monthStart } },
    }),
    prisma.user.count({
      where: { role: "USER", createdAt: { gte: weekStart } },
    }),
  ]);

  // Active this month: users with bookings or orders created this month
  const [activeBookers, activeOrderers] = await Promise.all([
    prisma.booking.findMany({
      where: { createdAt: { gte: monthStart } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: monthStart } },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);

  const activeUserIds = new Set([
    ...activeBookers.map((b) => b.userId),
    ...activeOrderers.map((o) => o.userId),
  ]);
  const activeThisMonth = activeUserIds.size;

  // Top spenders: fetch all users with completed bookings / delivered orders
  const usersWithActivity = await prisma.user.findMany({
    where: {
      role: "USER",
      OR: [
        { bookings: { some: { status: "COMPLETED" } } },
        { orders: { some: { status: "DELIVERED" } } },
      ],
    },
    select: {
      id: true,
      name: true,
      bookings: {
        where: { status: "COMPLETED" },
        select: { startTime: true, endTime: true, resourceId: true },
      },
      orders: {
        where: { status: "DELIVERED" },
        select: { totalAmount: true },
      },
    },
  });

  const resources = await prisma.resource.findMany({
    select: { id: true, pricePerHour: true },
  });
  const priceMap = new Map(
    resources.map((r) => [r.id, Number(r.pricePerHour ?? 0)])
  );

  const spenders = usersWithActivity
    .map((u) => {
      let spent = 0;
      for (const b of u.bookings) {
        spent += calculateBookingCost(
          b.startTime,
          b.endTime,
          priceMap.get(b.resourceId) ?? null
        );
      }
      for (const o of u.orders) {
        spent += Number(o.totalAmount);
      }
      return {
        id: u.id,
        name: u.name,
        totalSpent: Math.round(spent * 100) / 100,
      };
    })
    .sort((a, b) => b.totalSpent - a.totalSpent);

  const topSpenders = spenders.slice(0, 5);

  // Module breakdown: count distinct users per module
  const [gazeboUsers, psParkUsers, cafeUsers] = await Promise.all([
    prisma.booking.findMany({
      where: { moduleSlug: "gazebos" },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.booking.findMany({
      where: { moduleSlug: "ps-park" },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.order.findMany({
      where: { moduleSlug: "cafe" },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);

  const moduleBreakdown = [
    {
      moduleSlug: "gazebos",
      moduleName: "Беседки",
      clientCount: gazeboUsers.length,
    },
    {
      moduleSlug: "ps-park",
      moduleName: "PS Park",
      clientCount: psParkUsers.length,
    },
    {
      moduleSlug: "cafe",
      moduleName: "Кафе",
      clientCount: cafeUsers.length,
    },
  ];

  return {
    totalClients,
    newThisMonth,
    newThisWeek,
    activeThisMonth,
    topSpenders,
    moduleBreakdown,
  };
}
