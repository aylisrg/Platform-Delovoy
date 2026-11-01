import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";
import { normalizePhone } from "@/lib/phone";
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
import type {
  ClientFilterInput,
  CreateClientInput,
  UpdateClientInput,
} from "./validation";

// F4 ADR — domain error for client CRUD. Mirrors PSBookingError / OrderError.
export class ClientError extends Error {
  code: string;
  metadata?: Record<string, unknown>;
  constructor(code: string, message: string, metadata?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.name = "ClientError";
    if (metadata) this.metadata = metadata;
  }
}

const MODULE_NAMES: Record<string, string> = {
  gazebos: "Барбекю Парк",
  "ps-park": "Плей Парк",
  cafe: "Кафе",
};

const BOOKING_MODULES = ["gazebos", "ps-park"] as const;
const ORDER_MODULES = ["cafe"] as const;

// Prod memory guards for the unbounded scans in this module.
// Computed sorts (totalSpent / lastActivity) and the stats top-spenders
// aggregation can't be paginated in SQL, so we scan at most CLIENTS_SCAN_CAP
// users (newest first) and cap each user's nested relations at
// RELATION_SCAN_CAP to avoid pulling a whole booking/order history into memory.
const CLIENTS_SCAN_CAP = 1000;
const RELATION_SCAN_CAP = 500;

// TTL (seconds) for the cached getClientStats() payload.
const STATS_CACHE_KEY = "clients:stats";
const STATS_CACHE_TTL = 300;

/**
 * F8 RBAC — guard for "manager can only see guests of their own modules".
 *
 * Returns `true` iff the viewer is allowed to see the given client's full
 * profile. Rules:
 *   - Anyone with the explicit `clients` admin section grant (incl. SUPERADMIN
 *     auto-grant) sees every guest.
 *   - A module-only manager (e.g. `ps-park` granted, no `clients`) only sees
 *     guests who actually used at least one module they have access to —
 *     either a booking with `moduleSlug ∈ accessible` or an order in the
 *     same set.
 *   - Anyone else (USER, manager with no module grants, guest sessions) — false.
 *
 * Use this from BOTH the page-level guard (server component) AND the API
 * route handler — UI guard alone is bypassable via direct GET on the JSON
 * endpoint.
 */
export async function canViewClient(
  viewerUserId: string,
  clientUserId: string
): Promise<boolean> {
  const { getUserAdminSections } = await import("@/lib/permissions");
  const sections = await getUserAdminSections(viewerUserId);
  if (sections.length === 0) return false;
  if (sections.includes("clients")) return true;

  // Filter to module sections that actually have bookings/orders linked.
  const moduleSections = sections.filter(
    (s) =>
      (BOOKING_MODULES as readonly string[]).includes(s) ||
      (ORDER_MODULES as readonly string[]).includes(s)
  );
  if (moduleSections.length === 0) return false;

  const [bookingMatch, orderMatch] = await Promise.all([
    prisma.booking.findFirst({
      where: {
        userId: clientUserId,
        moduleSlug: { in: moduleSections },
        deletedAt: null,
      },
      select: { id: true },
    }),
    prisma.order.findFirst({
      where: {
        userId: clientUserId,
        moduleSlug: { in: moduleSections },
      },
      select: { id: true },
    }),
  ]);
  return Boolean(bookingMatch || orderMatch);
}

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

  // `createdAt`/`name` (and the default) are DB-sortable, so paginate in SQL and
  // load nested relations for a single page only. `totalSpent`/`lastActivity`
  // are computed in JS and can't be pushed down — for those we scan a bounded
  // window (CLIENTS_SCAN_CAP users, newest first) with capped nested relations.
  const isComputedSort = sortBy === "totalSpent" || sortBy === "lastActivity";

  const baseUserFields = {
    id: true,
    name: true,
    email: true,
    phone: true,
    image: true,
    telegramId: true,
    vkId: true,
    createdAt: true,
    accounts: { select: { provider: true } },
  } as const;

  const bookingFields = {
    id: true,
    moduleSlug: true,
    status: true,
    startTime: true,
    endTime: true,
    resourceId: true,
    createdAt: true,
  } as const;

  const orderFields = {
    id: true,
    moduleSlug: true,
    status: true,
    totalAmount: true,
    createdAt: true,
  } as const;

  // Two concrete queries (rather than one union-typed args object) so Prisma
  // can infer the row payload type for each path.
  const [users, total] = await Promise.all([
    isComputedSort
      ? prisma.user.findMany({
          where: userWhere,
          select: {
            ...baseUserFields,
            bookings: {
              select: bookingFields,
              take: RELATION_SCAN_CAP,
              orderBy: { createdAt: "desc" },
            },
            orders: {
              select: orderFields,
              take: RELATION_SCAN_CAP,
              orderBy: { createdAt: "desc" },
            },
          },
          orderBy: { createdAt: "desc" },
          take: CLIENTS_SCAN_CAP,
        })
      : prisma.user.findMany({
          where: userWhere,
          select: {
            ...baseUserFields,
            bookings: { select: bookingFields },
            orders: { select: orderFields },
          },
          orderBy:
            sortBy === "name"
              ? { name: sortOrder }
              : { createdAt: sortOrder },
          skip: offset,
          take: limit,
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

  // DB-sortable path: `findMany` already applied orderBy + skip + take, so the
  // aggregated array IS the requested page — return it unsliced.
  if (!isComputedSort) {
    return { clients, total };
  }

  // Computed-sort path: order the bounded scan window in JS, then page it.
  clients.sort((a, b) => {
    const dir = sortOrder === "asc" ? 1 : -1;
    switch (sortBy) {
      case "totalSpent":
        return (a.totalSpent - b.totalSpent) * dir;
      case "lastActivity":
      default: {
        const aTime = a.lastActivityAt
          ? new Date(a.lastActivityAt).getTime()
          : 0;
        const bTime = b.lastActivityAt
          ? new Date(b.lastActivityAt).getTime()
          : 0;
        return (aTime - bTime) * dir;
      }
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
      birthday: true,
      notes: true,
      createdAt: true,
      // Exact totals regardless of the nested `take` caps below.
      _count: { select: { bookings: true, orders: true } },
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
        take: RELATION_SCAN_CAP,
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
        take: RELATION_SCAN_CAP,
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
    birthday: user.birthday ? user.birthday.toISOString().slice(0, 10) : null,
    notes: user.notes,
    createdAt: user.createdAt.toISOString(),
    modulesUsed,
    totalSpent: Math.round(totalSpent * 100) / 100,
    bookingCount: user._count.bookings,
    orderCount: user._count.orders,
    lastActivityAt,
    authProviders: getAuthProviders(user),
    bookings,
    orders,
    activityTimeline,
    spendingByMonth,
  };
}

export async function getClientStats(): Promise<ClientStats> {
  // Cache the whole payload for 5 minutes. Fail-open: any Redis hiccup falls
  // through to live computation (never throws on the read path).
  if (redisAvailable) {
    try {
      const cached = await redis.get(STATS_CACHE_KEY);
      if (cached) return JSON.parse(cached) as ClientStats;
    } catch {
      // Cache miss / Redis error — compute live.
    }
  }

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

  // Active this month: distinct users with a booking OR order this month.
  // Counted in SQL (UNION + COUNT(DISTINCT)) instead of scanning every row.
  const activeRows = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(DISTINCT "userId")::int AS count FROM (
      SELECT "userId" FROM "Booking" WHERE "createdAt" >= ${monthStart}
      UNION
      SELECT "userId" FROM "Order" WHERE "createdAt" >= ${monthStart}
    ) AS active
  `;
  const activeThisMonth = activeRows[0]?.count ?? 0;

  // Top spenders: bounded scan of users with completed bookings / delivered
  // orders (newest first), each with capped nested relations.
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
        take: RELATION_SCAN_CAP,
        orderBy: { createdAt: "desc" },
      },
      orders: {
        where: { status: "DELIVERED" },
        select: { totalAmount: true },
        take: RELATION_SCAN_CAP,
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: CLIENTS_SCAN_CAP,
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

  // Module breakdown: distinct users per module, counted in SQL.
  const [gazeboRows, psParkRows, cafeRows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT "userId")::int AS count
      FROM "Booking" WHERE "moduleSlug" = 'gazebos'
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT "userId")::int AS count
      FROM "Booking" WHERE "moduleSlug" = 'ps-park'
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT "userId")::int AS count
      FROM "Order" WHERE "moduleSlug" = 'cafe'
    `,
  ]);

  const moduleBreakdown = [
    {
      moduleSlug: "gazebos",
      moduleName: "Барбекю Парк",
      clientCount: gazeboRows[0]?.count ?? 0,
    },
    {
      moduleSlug: "ps-park",
      moduleName: "Плей Парк",
      clientCount: psParkRows[0]?.count ?? 0,
    },
    {
      moduleSlug: "cafe",
      moduleName: "Кафе",
      clientCount: cafeRows[0]?.count ?? 0,
    },
  ];

  const result: ClientStats = {
    totalClients,
    newThisMonth,
    newThisWeek,
    activeThisMonth,
    topSpenders,
    moduleBreakdown,
  };

  // Fail-open cache write.
  if (redisAvailable) {
    try {
      await redis.setex(STATS_CACHE_KEY, STATS_CACHE_TTL, JSON.stringify(result));
    } catch {
      // Ignore cache write errors.
    }
  }

  return result;
}

// === Client CRUD (F4 ADR 2026-05-04-clients-guest-cards-crud) ===

/**
 * Create a new guest card. 409 (CLIENT_PHONE_DUPLICATE) if an active User with
 * the same normalized phone already exists — surfaces existing id so the UI
 * can navigate to it instead of silently re-using.
 */
export async function createClient(
  input: CreateClientInput,
  performedById: string
): Promise<{ id: string }> {
  const normalized = normalizePhone(input.phone);
  if (!normalized) {
    throw new ClientError("INVALID_PHONE", "Некорректный формат телефона");
  }

  const existing = await prisma.user.findFirst({
    where: { phoneNormalized: normalized, role: "USER", mergedIntoUserId: null },
    select: { id: true },
  });
  if (existing) {
    throw new ClientError(
      "CLIENT_PHONE_DUPLICATE",
      "Гость с таким телефоном уже существует",
      { existingClientId: existing.id }
    );
  }

  const created = await prisma.user.create({
    data: {
      role: "USER",
      phone: input.phone,
      phoneNormalized: normalized,
      name: input.name ?? null,
      email: input.email ?? null,
      birthday: input.birthday ? new Date(input.birthday) : null,
      notes: input.notes ?? null,
      tags: input.tags ?? [],
      source: "manual",
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      userId: performedById,
      action: "client.create",
      entity: "User",
      entityId: created.id,
      metadata: {
        phoneNormalized: normalized,
        source: "manual",
        createdBy: performedById,
      },
    },
  });

  return { id: created.id };
}

/**
 * Update editable client fields. Phone is intentionally NOT in input —
 * smena phone-а — это операция merge, отдельный механизм.
 */
export async function updateClient(
  id: string,
  input: UpdateClientInput,
  performedById: string
): Promise<void> {
  const existing = await prisma.user.findFirst({
    where: { id, role: "USER", mergedIntoUserId: null },
    select: { name: true, email: true, birthday: true, notes: true, tags: true },
  });
  if (!existing) {
    throw new ClientError("CLIENT_NOT_FOUND", "Гость не найден");
  }

  const data: Record<string, unknown> = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  if (input.name !== undefined && input.name !== existing.name) {
    data.name = input.name;
    changes.name = { from: existing.name, to: input.name };
  }
  if (input.email !== undefined && input.email !== existing.email) {
    data.email = input.email;
    changes.email = { from: existing.email, to: input.email };
  }
  if (input.birthday !== undefined) {
    const newBirthday = input.birthday ? new Date(input.birthday) : null;
    const existingIso = existing.birthday
      ? existing.birthday.toISOString().slice(0, 10)
      : null;
    if (input.birthday !== existingIso) {
      data.birthday = newBirthday;
      changes.birthday = { from: existingIso, to: input.birthday };
    }
  }
  if (input.notes !== undefined && input.notes !== existing.notes) {
    data.notes = input.notes;
    changes.notes = { from: existing.notes, to: input.notes };
  }
  if (input.tags !== undefined) {
    const sameTags =
      existing.tags.length === input.tags.length &&
      existing.tags.every((t, i) => t === input.tags![i]);
    if (!sameTags) {
      data.tags = input.tags;
      changes.tags = { from: existing.tags, to: input.tags };
    }
  }

  if (Object.keys(data).length === 0) return;

  await prisma.user.update({ where: { id }, data });

  await prisma.auditLog.create({
    data: {
      userId: performedById,
      action: "client.update",
      entity: "User",
      entityId: id,
      metadata: { changes } as unknown as import("@prisma/client").Prisma.InputJsonValue,
    },
  });
}

/**
 * Idempotent helper used by createAdminBooking (PS Park) so guests typed in
 * by managers are deduplicated by E.164 phone instead of the raw string.
 *
 * Race-condition handling without a partial UNIQUE on phoneNormalized
 * (Architect Q1 — see ADR §9):
 *   1. Optimistic findFirst
 *   2. If exists, fill name/source iff null (don't clobber edits)
 *   3. Otherwise create — but immediately re-scan and, if a concurrent
 *      writer also created a row, register a MergeCandidate and return the
 *      oldest by createdAt so both racers see the same id.
 */
export async function upsertClientByPhone(
  rawPhone: string,
  opts: { name?: string | null; source: string }
): Promise<{ id: string; created: boolean }> {
  const normalized = normalizePhone(rawPhone);
  if (!normalized) {
    throw new ClientError("INVALID_PHONE", "Некорректный формат телефона");
  }

  const existing = await prisma.user.findFirst({
    where: { phoneNormalized: normalized, role: "USER", mergedIntoUserId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, source: true },
  });
  if (existing) {
    const patch: { name?: string; source?: string } = {};
    if (!existing.name && opts.name) patch.name = opts.name;
    if (!existing.source) patch.source = opts.source;
    if (Object.keys(patch).length > 0) {
      await prisma.user.update({ where: { id: existing.id }, data: patch });
    }
    return { id: existing.id, created: false };
  }

  const created = await prisma.user.create({
    data: {
      role: "USER",
      phone: rawPhone,
      phoneNormalized: normalized,
      name: opts.name ?? null,
      source: opts.source,
    },
    select: { id: true },
  });

  // Post-create reconciliation: detect concurrent insert and register the
  // duplicate as a MergeCandidate. The oldest row (by createdAt) wins.
  const all = await prisma.user.findMany({
    where: { phoneNormalized: normalized, role: "USER", mergedIntoUserId: null },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { id: true },
  });
  if (all.length > 1) {
    const winner = all[0]!;
    for (const dup of all.slice(1)) {
      if (dup.id === winner.id) continue;
      await prisma.mergeCandidate.upsert({
        where: {
          primaryUserId_candidateUserId: {
            primaryUserId: winner.id,
            candidateUserId: dup.id,
          },
        },
        update: {},
        create: {
          primaryUserId: winner.id,
          candidateUserId: dup.id,
          matchedFields: ["phoneNormalized"],
          matchScore: 1.0,
          status: "PENDING",
        },
      });
    }
    return { id: winner.id, created: winner.id === created.id };
  }

  return { id: created.id, created: true };
}

// === Client Merge ===
// The merge engine lives in `./merge.ts` (ADR 2026-10-25-team-access-notifications
// §5.4). `mergeClients` / `previewMerge` stay importable from here — they are
// thin `clients_only` wrappers over `mergeAccounts`.
export { mergeClients, previewMerge } from "./merge";
