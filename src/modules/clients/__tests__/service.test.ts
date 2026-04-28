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
    // mergeClients tests inject their own implementation per-test.
    $transaction: vi.fn(),
  },
}));

import {
  listClients,
  getClientDetail,
  getClientStats,
  calculateBookingCost,
  mergeClients,
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
  accounts: [] as { provider: string }[],
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

  it("excludes tombstoned (merged) users from list", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0 as never);
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);

    await listClients();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "USER",
          mergedIntoUserId: null,
        }),
      })
    );
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ mergedIntoUserId: null }),
    });
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

  it("returns null for tombstoned (merged) user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const result = await getClientDetail("merged-user");

    expect(result).toBeNull();
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "merged-user",
          role: "USER",
          mergedIntoUserId: null,
        }),
      })
    );
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

// ============================================================================
// mergeClients — soft-merge with FK transfer (no hard-delete)
//
// Strategy: build an in-memory mock `tx` whose tables are plain arrays.
// Each Prisma method we use is implemented just enough to make the merge
// run end-to-end. Then we assert on the post-merge state of the arrays
// (and on the AuditLog row) for each scenario.
// ============================================================================

type Row = Record<string, unknown>;
type TxTables = Record<string, Row[]>;

function makeUser(overrides: Partial<Row> = {}): Row {
  return {
    id: "u-x",
    role: "USER",
    name: null,
    email: null,
    phone: null,
    image: null,
    telegramId: null,
    vkId: null,
    phoneNormalized: null,
    emailNormalized: null,
    mergedIntoUserId: null,
    mergedAt: null,
    ...overrides,
  };
}

function buildTx(tables: TxTables) {
  const t = (name: string): Row[] => {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  };

  const matches = (row: Row, where: Row): boolean => {
    for (const [k, v] of Object.entries(where)) {
      if (row[k] !== v) return false;
    }
    return true;
  };

  const updateMany = (table: string) => async ({ where, data }: { where: Row; data: Row }) => {
    let count = 0;
    for (const row of t(table)) {
      if (matches(row, where)) {
        Object.assign(row, data);
        count++;
      }
    }
    return { count };
  };

  const findMany = (table: string) => async ({ where = {} }: { where?: Row; select?: Row } = {}) => {
    return t(table).filter((r) => matches(r, where));
  };

  const findUnique = (table: string) => async ({ where }: { where: Row }) => {
    return t(table).find((r) => matches(r, where)) ?? null;
  };

  const deleteOne = (table: string) => async ({ where }: { where: Row }) => {
    const arr = t(table);
    const idx = arr.findIndex((r) => matches(r, where));
    if (idx === -1) throw new Error(`No ${table} row matches delete()`);
    return arr.splice(idx, 1)[0];
  };

  const deleteMany = (table: string) => async ({ where }: { where: Row }) => {
    const arr = t(table);
    let count = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (matches(arr[i], where)) {
        arr.splice(i, 1);
        count++;
      }
    }
    return { count };
  };

  const update = (table: string) => async ({ where, data }: { where: Row; data: Row }) => {
    const row = t(table).find((r) => matches(r, where));
    if (!row) throw new Error(`No ${table} row matches update()`);
    Object.assign(row, data);
    return row;
  };

  const create = (table: string) => async ({ data }: { data: Row }) => {
    const row = { id: `${table}-${t(table).length + 1}`, ...data };
    t(table).push(row);
    return row;
  };

  const tableApi = (name: string) => ({
    findMany: findMany(name),
    findUnique: findUnique(name),
    update: update(name),
    updateMany: updateMany(name),
    delete: deleteOne(name),
    deleteMany: deleteMany(name),
    create: create(name),
  });

  return {
    user: tableApi("user"),
    booking: tableApi("booking"),
    order: tableApi("order"),
    account: tableApi("account"),
    session: tableApi("session"),
    auditLog: tableApi("auditLog"),
    feedbackItem: tableApi("feedbackItem"),
    notificationLog: tableApi("notificationLog"),
    notificationPreference: tableApi("notificationPreference"),
    moduleAssignment: tableApi("moduleAssignment"),
    adminPermission: tableApi("adminPermission"),
    rentalChangeLog: tableApi("rentalChangeLog"),
    telegramLinkToken: tableApi("telegramLinkToken"),
    backupLog: {
      ...tableApi("backupLog"),
      // backupLog uses performedById, not userId — re-bind updateMany to that key.
      // (our generic matches() already handles arbitrary where keys.)
    },
    task: tableApi("task"),
    taskAssignee: tableApi("taskAssignee"),
    taskComment: tableApi("taskComment"),
    taskEvent: tableApi("taskEvent"),
    taskSubscription: tableApi("taskSubscription"),
    savedTaskView: tableApi("savedTaskView"),
    userNotificationChannel: tableApi("userNotificationChannel"),
    notificationEventPreference: tableApi("notificationEventPreference"),
    notificationGlobalPreference: tableApi("notificationGlobalPreference"),
    outgoingNotification: tableApi("outgoingNotification"),
  };
}

function installTx(tables: TxTables) {
  vi.mocked(prisma.$transaction as unknown as (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>)
    .mockImplementation(async (cb) => cb(buildTx(tables)));
}

describe("mergeClients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: transfers FK from secondary to primary, tombstones secondary", async () => {
    const tables: TxTables = {
      user: [
        makeUser({ id: "primary", email: "p@test.com", phone: "+79991111111", phoneNormalized: "79991111111" }),
        makeUser({ id: "secondary", name: "Иван", phone: "+79992222222", phoneNormalized: "79992222222" }),
      ],
      booking: [{ id: "b1", userId: "secondary" }, { id: "b2", userId: "secondary" }],
      order: [{ id: "o1", userId: "secondary" }],
      auditLog: [{ id: "a-old", userId: "secondary", action: "old" }],
    };
    installTx(tables);

    const result = await mergeClients("primary", "secondary", "admin-1");

    expect(result.primaryId).toBe("primary");
    expect(result.tombstonedUserId).toBe("secondary");
    expect(result.deletedUserId).toBe("secondary"); // backwards-compat alias
    expect(result.merged.bookings).toBe(2);
    expect(result.merged.orders).toBe(1);
    // existing auditLogs row reassigned (the new "auth.merge.manual" row is a separate create)
    expect(result.merged.auditLogs).toBe(1);

    // FK rewritten
    for (const b of tables.booking) expect(b.userId).toBe("primary");
    for (const o of tables.order) expect(o.userId).toBe("primary");

    // primary enriched with secondary's name (was null)
    const primary = tables.user.find((u) => u.id === "primary")!;
    expect(primary.name).toBe("Иван");
    // primary's email/phone NOT overwritten (primary wins)
    expect(primary.email).toBe("p@test.com");
    expect(primary.phone).toBe("+79991111111");
  });

  it("regression: secondary is NOT hard-deleted — it becomes a tombstone", async () => {
    const tables: TxTables = {
      user: [
        makeUser({ id: "primary" }),
        makeUser({ id: "secondary", email: "s@test.com" }),
      ],
    };
    installTx(tables);

    await mergeClients("primary", "secondary", "admin-1");

    // The row still exists.
    const sec = tables.user.find((u) => u.id === "secondary");
    expect(sec).toBeDefined();
    // mergedIntoUserId points at primary, mergedAt is set.
    expect(sec!.mergedIntoUserId).toBe("primary");
    expect(sec!.mergedAt).toBeInstanceOf(Date);
    // unique fields freed.
    expect(sec!.email).toBeNull();
    expect(sec!.phone).toBeNull();
    expect(sec!.telegramId).toBeNull();
    expect(sec!.vkId).toBeNull();
    expect(sec!.phoneNormalized).toBeNull();
    expect(sec!.emailNormalized).toBeNull();
  });

  it("regression: Phase 5.4 FK (Task, TaskAssignee, TaskComment, TaskEvent, channels, prefs) all transferred", async () => {
    const tables: TxTables = {
      user: [makeUser({ id: "primary" }), makeUser({ id: "secondary" })],
      task: [{ id: "t1", reporterUserId: "secondary" }],
      taskAssignee: [{ id: "ta1", taskId: "t99", userId: "secondary", role: "RESPONSIBLE" }],
      taskComment: [{ id: "tc1", taskId: "t1", authorUserId: "secondary" }],
      taskEvent: [{ id: "te1", taskId: "t1", actorUserId: "secondary" }],
      taskSubscription: [{ id: "ts1", userId: "secondary", scope: "TASK", taskId: "t1", boardId: null, categoryId: null }],
      savedTaskView: [{ id: "sv1", userId: "secondary", name: "view" }],
      userNotificationChannel: [{ id: "ch1", userId: "secondary", kind: "TELEGRAM", address: "12345" }],
      notificationEventPreference: [{ id: "nep1", userId: "secondary", eventType: "task.created" }],
      notificationGlobalPreference: [{ userId: "secondary", timezone: "Europe/Moscow", quietHoursFrom: null, quietHoursTo: null, dndUntil: null }],
      auditLog: [{ id: "al1", userId: "secondary", action: "x" }],
    };
    installTx(tables);

    const result = await mergeClients("primary", "secondary", "admin-1");

    expect(tables.task[0].reporterUserId).toBe("primary");
    expect(tables.taskAssignee[0].userId).toBe("primary");
    expect(tables.taskComment[0].authorUserId).toBe("primary");
    expect(tables.taskEvent[0].actorUserId).toBe("primary");
    expect(tables.taskSubscription[0].userId).toBe("primary");
    expect(tables.savedTaskView[0].userId).toBe("primary");
    expect(tables.userNotificationChannel[0].userId).toBe("primary");
    expect(tables.notificationEventPreference[0].userId).toBe("primary");
    // Global pref: copied across (PK is userId, can't UPDATE).
    expect(tables.notificationGlobalPreference.find((p) => p.userId === "primary")).toBeDefined();
    expect(tables.notificationGlobalPreference.find((p) => p.userId === "secondary")).toBeUndefined();
    expect(tables.auditLog.find((a) => a.id === "al1")!.userId).toBe("primary");

    expect(result.merged.reportedTasks).toBe(1);
    expect(result.merged.taskAssignments).toBe(1);
    expect(result.merged.taskComments).toBe(1);
    expect(result.merged.taskEvents).toBe(1);
    expect(result.merged.taskSubscriptions).toBe(1);
    expect(result.merged.savedTaskViews).toBe(1);
    expect(result.merged.notificationChannels).toBe(1);
    expect(result.merged.notificationEventPrefs).toBe(1);
    expect(result.merged.notificationGlobalPref).toBe(1);
  });

  it("edge: UserNotificationChannel unique conflict — primary wins, secondary's channel is dropped", async () => {
    const tables: TxTables = {
      user: [makeUser({ id: "primary" }), makeUser({ id: "secondary" })],
      userNotificationChannel: [
        { id: "p-tg", userId: "primary", kind: "TELEGRAM", address: "777" },
        { id: "s-tg", userId: "secondary", kind: "TELEGRAM", address: "777" }, // same kind+address
        { id: "s-email", userId: "secondary", kind: "EMAIL", address: "x@y.z" }, // unique to secondary
      ],
      outgoingNotification: [
        { id: "on1", userId: "secondary", channelId: "s-tg", eventType: "x" }, // tied to dropped channel
      ],
    };
    installTx(tables);

    await mergeClients("primary", "secondary", "admin-1");

    // Primary's channel preserved.
    expect(tables.userNotificationChannel.find((c) => c.id === "p-tg")).toBeDefined();
    // Secondary's duplicate dropped.
    expect(tables.userNotificationChannel.find((c) => c.id === "s-tg")).toBeUndefined();
    // Secondary's unique channel reassigned.
    const sEmail = tables.userNotificationChannel.find((c) => c.id === "s-email");
    expect(sEmail).toBeDefined();
    expect(sEmail!.userId).toBe("primary");
    // OutgoingNotification tied to dropped channel was cleaned.
    expect(tables.outgoingNotification.find((o) => o.id === "on1")).toBeUndefined();
  });

  it("edge: Account unique conflict on (provider, providerAccountId) — same provider/id is dropped, others move", async () => {
    const tables: TxTables = {
      user: [makeUser({ id: "primary" }), makeUser({ id: "secondary" })],
      account: [
        { id: "p-tg", userId: "primary", provider: "telegram", providerAccountId: "777" },
        { id: "s-tg", userId: "secondary", provider: "telegram", providerAccountId: "777" }, // dup
        { id: "s-email", userId: "secondary", provider: "email", providerAccountId: "x@y.z" }, // unique
      ],
    };
    installTx(tables);

    const result = await mergeClients("primary", "secondary", "admin-1");

    expect(tables.account.find((a) => a.id === "p-tg")).toBeDefined();
    expect(tables.account.find((a) => a.id === "s-tg")).toBeUndefined();
    const sEmail = tables.account.find((a) => a.id === "s-email");
    expect(sEmail!.userId).toBe("primary");
    expect(result.merged.accounts).toBe(1); // only s-email transferred
  });

  it("edge: secondary's email/phone are freed so a new user can claim them", async () => {
    const tables: TxTables = {
      user: [
        makeUser({ id: "primary" }),
        makeUser({ id: "secondary", email: "freed@test.com", phone: "+79993333333", emailNormalized: "freed@test.com", phoneNormalized: "79993333333" }),
      ],
    };
    installTx(tables);

    await mergeClients("primary", "secondary", "admin-1");

    const sec = tables.user.find((u) => u.id === "secondary")!;
    expect(sec.email).toBeNull();
    expect(sec.phone).toBeNull();
    expect(sec.emailNormalized).toBeNull();
    expect(sec.phoneNormalized).toBeNull();
    // (DB-level uniqueness is verified by the partial-unique index in the
    // migration; here we only assert the application contract.)
  });

  it("audit log: writes a single auth.merge.manual entry with primaryId/secondaryId/fkMoved metadata", async () => {
    const tables: TxTables = {
      user: [makeUser({ id: "primary" }), makeUser({ id: "secondary", name: "Bob" })],
      booking: [{ id: "b1", userId: "secondary" }],
    };
    installTx(tables);

    await mergeClients("primary", "secondary", "admin-7");

    const mergeLog = tables.auditLog.find((l) => l.action === "auth.merge.manual");
    expect(mergeLog).toBeDefined();
    expect(mergeLog!.userId).toBe("admin-7");
    expect(mergeLog!.entity).toBe("User");
    expect(mergeLog!.entityId).toBe("primary");
    const meta = mergeLog!.metadata as Record<string, unknown>;
    expect(meta.primaryId).toBe("primary");
    expect(meta.secondaryId).toBe("secondary");
    expect(meta.source).toBe("admin_ui");
    expect((meta.fkMoved as Record<string, number>).bookings).toBe(1);
  });

  it("error: refuses to merge a user with itself", async () => {
    installTx({ user: [makeUser({ id: "same" })] });
    await expect(mergeClients("same", "same", "admin-1")).rejects.toThrow(/сам с собой/);
  });

  it("error: throws if primary not found", async () => {
    installTx({ user: [makeUser({ id: "secondary" })] });
    await expect(mergeClients("missing", "secondary", "admin-1")).rejects.toThrow(/Основной клиент не найден/);
  });

  it("error: throws if secondary not found", async () => {
    installTx({ user: [makeUser({ id: "primary" })] });
    await expect(mergeClients("primary", "missing", "admin-1")).rejects.toThrow(/Второй клиент не найден/);
  });

  it("error: refuses to merge already-tombstoned secondary", async () => {
    installTx({
      user: [
        makeUser({ id: "primary" }),
        makeUser({ id: "secondary", mergedIntoUserId: "older-primary" }),
      ],
    });
    await expect(mergeClients("primary", "secondary", "admin-1")).rejects.toThrow(/уже объединён/);
  });

  it("error: refuses to merge into a non-USER role", async () => {
    installTx({
      user: [
        makeUser({ id: "primary", role: "MANAGER" }),
        makeUser({ id: "secondary" }),
      ],
    });
    await expect(mergeClients("primary", "secondary", "admin-1")).rejects.toThrow(/не является клиентом/);
  });
});
