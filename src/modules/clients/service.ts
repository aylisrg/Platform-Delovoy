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
  MergePreview,
  MergeResult,
} from "./types";
import type { ClientFilterInput } from "./validation";

const MODULE_NAMES: Record<string, string> = {
  gazebos: "Барбекю Парк",
  "ps-park": "Плей Парк",
  cafe: "Кафе",
};

const BOOKING_MODULES = ["gazebos", "ps-park"] as const;
const ORDER_MODULES = ["cafe"] as const;

function getAuthProviders(user: {
  telegramId: string | null;
  email: string | null;
  accounts: { provider: string }[];
}): string[] {
  const providers: string[] = [];

  for (const acc of user.accounts) {
    if (!providers.includes(acc.provider)) {
      providers.push(acc.provider);
    }
  }

  if (user.telegramId && !providers.includes("telegram")) {
    providers.push("telegram");
  }

  if (user.email && providers.length === 0 && !user.telegramId) {
    providers.push("credentials");
  }

  return providers;
}

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
  const userWhere: any = { role: "USER" as const, mergedIntoUserId: null };

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
        accounts: {
          select: { provider: true },
        },
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
      authProviders: getAuthProviders(user),
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
    where: { id: userId, role: "USER", mergedIntoUserId: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      image: true,
      telegramId: true,
      vkId: true,
      createdAt: true,
      accounts: {
        select: { provider: true },
      },
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
    authProviders: getAuthProviders(user),
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
      moduleName: "Барбекю Парк",
      clientCount: gazeboUsers.length,
    },
    {
      moduleSlug: "ps-park",
      moduleName: "Плей Парк",
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

// === Client Merge ===

export async function previewMerge(
  primaryId: string,
  secondaryId: string
): Promise<MergePreview> {
  const [primary, secondary] = await Promise.all([
    prisma.user.findUnique({
      where: { id: primaryId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        telegramId: true,
        role: true,
        _count: { select: { bookings: true, orders: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: secondaryId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        telegramId: true,
        role: true,
        _count: { select: { bookings: true, orders: true } },
      },
    }),
  ]);

  if (!primary) throw new Error("Основной клиент не найден");
  if (!secondary) throw new Error("Второй клиент не найден");
  if (primary.role !== "USER") throw new Error("Основной аккаунт не является клиентом");
  if (secondary.role !== "USER") throw new Error("Второй аккаунт не является клиентом");

  const conflicts: string[] = [];
  if (primary.email && secondary.email && primary.email !== secondary.email) {
    conflicts.push(`У обоих клиентов есть email — будет использован email основного (${primary.email})`);
  }
  if (primary.phone && secondary.phone && primary.phone !== secondary.phone) {
    conflicts.push(`У обоих клиентов есть телефон — будет использован телефон основного (${primary.phone})`);
  }
  if (primary.telegramId && secondary.telegramId && primary.telegramId !== secondary.telegramId) {
    conflicts.push(`У обоих клиентов есть Telegram — будет использован TG основного`);
  }

  return {
    primary: {
      id: primary.id,
      name: primary.name,
      email: primary.email,
      phone: primary.phone,
      telegramId: primary.telegramId,
      bookingCount: primary._count.bookings,
      orderCount: primary._count.orders,
    },
    secondary: {
      id: secondary.id,
      name: secondary.name,
      email: secondary.email,
      phone: secondary.phone,
      telegramId: secondary.telegramId,
      bookingCount: secondary._count.bookings,
      orderCount: secondary._count.orders,
    },
    conflicts,
  };
}

/**
 * Merge `secondary` USER into `primary` USER.
 *
 * Soft-merge semantics (ADR 2026-04-27 §6):
 *  - All FK rows pointing at `secondary` are re-pointed to `primary`.
 *  - Unique-constrained relations (Account, ModuleAssignment, AdminPermission,
 *    TaskAssignee, TaskSubscription, UserNotificationChannel,
 *    NotificationEventPreference, NotificationGlobalPreference,
 *    NotificationPreference) are de-duplicated first (primary wins),
 *    then the remaining secondary rows are re-pointed.
 *  - Secondary's unique fields (email, phone, telegramId, vkId,
 *    phoneNormalized, emailNormalized) are nulled so a future login can
 *    claim them.
 *  - Secondary is **NOT** deleted. It's tombstoned via `mergedIntoUserId`
 *    + `mergedAt` so the AuditLog FK chain stays intact and analytics
 *    can still resolve historical user IDs.
 *
 * The whole operation runs inside a single Prisma transaction.
 */
export async function mergeClients(
  primaryId: string,
  secondaryId: string,
  performedById: string
): Promise<MergeResult> {
  if (primaryId === secondaryId) {
    throw new Error("Нельзя объединить аккаунт сам с собой");
  }

  return prisma.$transaction(async (tx) => {
    // ── 0. Validate both users exist, are USER role, and not already tombstoned
    const [primary, secondary] = await Promise.all([
      tx.user.findUnique({
        where: { id: primaryId },
        select: {
          id: true,
          role: true,
          name: true,
          email: true,
          phone: true,
          image: true,
          telegramId: true,
          vkId: true,
          mergedIntoUserId: true,
        },
      }),
      tx.user.findUnique({
        where: { id: secondaryId },
        select: {
          id: true,
          role: true,
          name: true,
          email: true,
          phone: true,
          image: true,
          telegramId: true,
          vkId: true,
          mergedIntoUserId: true,
        },
      }),
    ]);

    if (!primary) throw new Error("Основной клиент не найден");
    if (!secondary) throw new Error("Второй клиент не найден");
    if (primary.role !== "USER") throw new Error("Основной аккаунт не является клиентом");
    if (secondary.role !== "USER") throw new Error("Второй аккаунт не является клиентом");
    if (primary.mergedIntoUserId) {
      throw new Error("Основной клиент уже объединён в другой аккаунт");
    }
    if (secondary.mergedIntoUserId) {
      throw new Error("Второй клиент уже объединён в другой аккаунт");
    }

    // ── 1. Simple FK transfers (no unique constraints involving userId)
    const [
      bookings,
      orders,
      auditLogs,
      feedbackItems,
      notificationLogs,
      sessions,
      rentalChangeLogs,
      telegramLinkTokens,
      backupLogs,
      reportedTasks,
      taskComments,
      taskEvents,
    ] = await Promise.all([
      tx.booking.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
      tx.order.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
      tx.auditLog.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
      tx.feedbackItem.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
      tx.notificationLog.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
      tx.session.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
      tx.rentalChangeLog.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
      tx.telegramLinkToken.updateMany({ where: { userId: secondaryId }, data: { userId: primaryId } }),
      tx.backupLog.updateMany({ where: { performedById: secondaryId }, data: { performedById: primaryId } }),
      tx.task.updateMany({ where: { reporterUserId: secondaryId }, data: { reporterUserId: primaryId } }),
      tx.taskComment.updateMany({ where: { authorUserId: secondaryId }, data: { authorUserId: primaryId } }),
      tx.taskEvent.updateMany({ where: { actorUserId: secondaryId }, data: { actorUserId: primaryId } }),
    ]);

    // ── 2. Account: @@unique([provider, providerAccountId]) — same provider on
    // both sides means primary keeps its row, secondary's is dropped.
    const primaryAccounts = await tx.account.findMany({
      where: { userId: primaryId },
      select: { provider: true, providerAccountId: true },
    });
    const primaryAccountKeys = new Set(
      primaryAccounts.map((a) => `${a.provider}::${a.providerAccountId}`)
    );
    const secondaryAccounts = await tx.account.findMany({
      where: { userId: secondaryId },
      select: { id: true, provider: true, providerAccountId: true },
    });
    let accountsTransferred = 0;
    for (const sa of secondaryAccounts) {
      const key = `${sa.provider}::${sa.providerAccountId}`;
      if (primaryAccountKeys.has(key)) {
        await tx.account.delete({ where: { id: sa.id } });
      } else {
        await tx.account.update({ where: { id: sa.id }, data: { userId: primaryId } });
        accountsTransferred++;
      }
    }

    // ── 3. ModuleAssignment: @@unique([userId, moduleId])
    const [primaryAssignments, secondaryAssignments] = await Promise.all([
      tx.moduleAssignment.findMany({ where: { userId: primaryId }, select: { moduleId: true } }),
      tx.moduleAssignment.findMany({ where: { userId: secondaryId }, select: { id: true, moduleId: true } }),
    ]);
    const primaryModuleIds = new Set(primaryAssignments.map((a) => a.moduleId));
    let moduleAssignmentsTransferred = 0;
    for (const sa of secondaryAssignments) {
      if (primaryModuleIds.has(sa.moduleId)) {
        await tx.moduleAssignment.delete({ where: { id: sa.id } });
      } else {
        await tx.moduleAssignment.update({ where: { id: sa.id }, data: { userId: primaryId } });
        moduleAssignmentsTransferred++;
      }
    }

    // ── 4. AdminPermission: @@unique([userId, section])
    const [primaryAdminPerms, secondaryAdminPerms] = await Promise.all([
      tx.adminPermission.findMany({ where: { userId: primaryId }, select: { section: true } }),
      tx.adminPermission.findMany({ where: { userId: secondaryId }, select: { id: true, section: true } }),
    ]);
    const primaryAdminSections = new Set(primaryAdminPerms.map((p) => p.section));
    let adminPermissionsTransferred = 0;
    for (const sp of secondaryAdminPerms) {
      if (primaryAdminSections.has(sp.section)) {
        await tx.adminPermission.delete({ where: { id: sp.id } });
      } else {
        await tx.adminPermission.update({ where: { id: sp.id }, data: { userId: primaryId } });
        adminPermissionsTransferred++;
      }
    }

    // ── 5. NotificationPreference: userId is @unique
    const primaryNotifPref = await tx.notificationPreference.findUnique({
      where: { userId: primaryId },
      select: { id: true },
    });
    let notificationPreferencesTransferred = 0;
    if (primaryNotifPref) {
      await tx.notificationPreference.deleteMany({ where: { userId: secondaryId } });
    } else {
      const moved = await tx.notificationPreference.updateMany({
        where: { userId: secondaryId },
        data: { userId: primaryId },
      });
      notificationPreferencesTransferred = moved.count;
    }

    // ── 6. TaskAssignee: @@unique([taskId, userId])
    const primaryTaskAssignments = await tx.taskAssignee.findMany({
      where: { userId: primaryId },
      select: { taskId: true },
    });
    const primaryAssignedTaskIds = new Set(primaryTaskAssignments.map((a) => a.taskId));
    const secondaryTaskAssignments = await tx.taskAssignee.findMany({
      where: { userId: secondaryId },
      select: { id: true, taskId: true },
    });
    let taskAssignmentsTransferred = 0;
    for (const sa of secondaryTaskAssignments) {
      if (primaryAssignedTaskIds.has(sa.taskId)) {
        await tx.taskAssignee.delete({ where: { id: sa.id } });
      } else {
        await tx.taskAssignee.update({ where: { id: sa.id }, data: { userId: primaryId } });
        taskAssignmentsTransferred++;
      }
    }

    // ── 7. TaskSubscription: @@unique([userId, scope, taskId, boardId, categoryId])
    const primaryTaskSubs = await tx.taskSubscription.findMany({
      where: { userId: primaryId },
      select: { scope: true, taskId: true, boardId: true, categoryId: true },
    });
    const primarySubKey = (s: {
      scope: string;
      taskId: string | null;
      boardId: string | null;
      categoryId: string | null;
    }) => `${s.scope}::${s.taskId ?? ""}::${s.boardId ?? ""}::${s.categoryId ?? ""}`;
    const primarySubKeys = new Set(primaryTaskSubs.map(primarySubKey));
    const secondaryTaskSubs = await tx.taskSubscription.findMany({
      where: { userId: secondaryId },
      select: { id: true, scope: true, taskId: true, boardId: true, categoryId: true },
    });
    let taskSubscriptionsTransferred = 0;
    for (const ss of secondaryTaskSubs) {
      if (primarySubKeys.has(primarySubKey(ss))) {
        await tx.taskSubscription.delete({ where: { id: ss.id } });
      } else {
        await tx.taskSubscription.update({ where: { id: ss.id }, data: { userId: primaryId } });
        taskSubscriptionsTransferred++;
      }
    }

    // ── 8. SavedTaskView: no unique on userId
    const savedTaskViews = await tx.savedTaskView.updateMany({
      where: { userId: secondaryId },
      data: { userId: primaryId },
    });

    // ── 9. UserNotificationChannel: @@unique([userId, kind, address])
    const primaryChannels = await tx.userNotificationChannel.findMany({
      where: { userId: primaryId },
      select: { kind: true, address: true },
    });
    const primaryChannelKeys = new Set(primaryChannels.map((c) => `${c.kind}::${c.address}`));
    const secondaryChannels = await tx.userNotificationChannel.findMany({
      where: { userId: secondaryId },
      select: { id: true, kind: true, address: true },
    });
    let notificationChannelsTransferred = 0;
    for (const sc of secondaryChannels) {
      if (primaryChannelKeys.has(`${sc.kind}::${sc.address}`)) {
        // OutgoingNotification rows referencing this channelId will cascade
        // delete behaviour is RESTRICT by default; clean them first.
        await tx.outgoingNotification.deleteMany({ where: { channelId: sc.id } });
        await tx.userNotificationChannel.delete({ where: { id: sc.id } });
      } else {
        await tx.userNotificationChannel.update({
          where: { id: sc.id },
          data: { userId: primaryId },
        });
        notificationChannelsTransferred++;
      }
    }

    // ── 10. NotificationEventPreference: @@unique([userId, eventType])
    const primaryEventPrefs = await tx.notificationEventPreference.findMany({
      where: { userId: primaryId },
      select: { eventType: true },
    });
    const primaryEventTypes = new Set(primaryEventPrefs.map((p) => p.eventType));
    const secondaryEventPrefs = await tx.notificationEventPreference.findMany({
      where: { userId: secondaryId },
      select: { id: true, eventType: true },
    });
    let notificationEventPrefsTransferred = 0;
    for (const sp of secondaryEventPrefs) {
      if (primaryEventTypes.has(sp.eventType)) {
        await tx.notificationEventPreference.delete({ where: { id: sp.id } });
      } else {
        await tx.notificationEventPreference.update({
          where: { id: sp.id },
          data: { userId: primaryId },
        });
        notificationEventPrefsTransferred++;
      }
    }

    // ── 11. NotificationGlobalPreference: userId is @id (one per user)
    const primaryGlobalPref = await tx.notificationGlobalPreference.findUnique({
      where: { userId: primaryId },
      select: { userId: true },
    });
    let notificationGlobalPrefTransferred = 0;
    if (primaryGlobalPref) {
      await tx.notificationGlobalPreference.deleteMany({ where: { userId: secondaryId } });
    } else {
      // userId is the PK — can't UPDATE, must copy then delete.
      const sec = await tx.notificationGlobalPreference.findUnique({
        where: { userId: secondaryId },
      });
      if (sec) {
        await tx.notificationGlobalPreference.create({
          data: {
            userId: primaryId,
            timezone: sec.timezone,
            quietHoursFrom: sec.quietHoursFrom,
            quietHoursTo: sec.quietHoursTo,
            dndUntil: sec.dndUntil,
          },
        });
        await tx.notificationGlobalPreference.delete({ where: { userId: secondaryId } });
        notificationGlobalPrefTransferred = 1;
      }
    }

    // ── 12. OutgoingNotification: userId is plain column (no @relation), but
    // we still own the data semantically. Reassign the rows that survived
    // step 9 (others were cleaned alongside their channel).
    const outgoingNotifications = await tx.outgoingNotification.updateMany({
      where: { userId: secondaryId },
      data: { userId: primaryId },
    });

    // ── 13. CallLog: tracks `clientPhone`, no userId FK — nothing to do.
    // Phone history follows the phone string, which moves with the merge
    // (since secondary's phone is being nulled).
    const callLogs = 0;

    // ── 14. Enrich primary with secondary's data (fill nulls only — primary wins)
    const updates: Record<string, string> = {};
    if (!primary.name && secondary.name) updates.name = secondary.name;
    if (!primary.phone && secondary.phone) updates.phone = secondary.phone;
    if (!primary.email && secondary.email) updates.email = secondary.email;
    if (!primary.image && secondary.image) updates.image = secondary.image;
    if (!primary.telegramId && secondary.telegramId) updates.telegramId = secondary.telegramId;
    if (!primary.vkId && secondary.vkId) updates.vkId = secondary.vkId;

    if (Object.keys(updates).length > 0) {
      await tx.user.update({ where: { id: primaryId }, data: updates });
    }

    // ── 15. Free secondary's unique fields + tombstone in one update.
    // After this UPDATE, anyone can register/login with secondary's old
    // phone/email/telegram/vk and Prisma's @unique won't conflict.
    await tx.user.update({
      where: { id: secondaryId },
      data: {
        email: null,
        phone: null,
        telegramId: null,
        vkId: null,
        phoneNormalized: null,
        emailNormalized: null,
        mergedIntoUserId: primaryId,
        mergedAt: new Date(),
      },
    });

    // ── 16. AuditLog (mutation log, per CLAUDE.md security rules)
    const fkMoved = {
      bookings: bookings.count,
      orders: orders.count,
      accounts: accountsTransferred,
      auditLogs: auditLogs.count,
      feedbackItems: feedbackItems.count,
      notificationLogs: notificationLogs.count,
      sessions: sessions.count,
      moduleAssignments: moduleAssignmentsTransferred,
      adminPermissions: adminPermissionsTransferred,
      rentalChangeLogs: rentalChangeLogs.count,
      notificationPreferences: notificationPreferencesTransferred,
      telegramLinkTokens: telegramLinkTokens.count,
      backupLogs: backupLogs.count,
      callLogs,
      reportedTasks: reportedTasks.count,
      taskAssignments: taskAssignmentsTransferred,
      taskComments: taskComments.count,
      taskEvents: taskEvents.count,
      taskSubscriptions: taskSubscriptionsTransferred,
      savedTaskViews: savedTaskViews.count,
      notificationChannels: notificationChannelsTransferred,
      notificationEventPrefs: notificationEventPrefsTransferred,
      notificationGlobalPref: notificationGlobalPrefTransferred,
      outgoingNotifications: outgoingNotifications.count,
    };

    await tx.auditLog.create({
      data: {
        userId: performedById,
        action: "auth.merge.manual",
        entity: "User",
        entityId: primaryId,
        metadata: {
          primaryId,
          secondaryId,
          secondaryName: secondary.name,
          secondaryEmail: secondary.email,
          transferredFields: updates,
          fkMoved,
          source: "admin_ui",
        },
      },
    });

    return {
      primaryId,
      merged: fkMoved,
      // `deletedUserId` kept for backwards compat with old route consumers;
      // the user is tombstoned, not deleted.
      deletedUserId: secondaryId,
      tombstonedUserId: secondaryId,
    };
  });
}
