import { prisma } from "@/lib/db";
import { logAudit, log } from "@/lib/logger";
import { getEventStats } from "./service";
import type {
  HealthStatus,
  ModuleMapEntry,
  AggregateAnalytics,
  AuditLogEntry,
  AuditFilter,
  AnalyticsFilter,
  ModuleConfigPatch,
} from "./architect-types";

export class ArchitectError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "ArchitectError";
  }
}

// ─── System Map ──────────────────────────────────────────────────────────────

async function fetchModuleHealth(
  slug: string
): Promise<{ status: HealthStatus; metrics: Record<string, unknown> }> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const res = await fetch(`${baseUrl}/api/${slug}/health`, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) {
      return { status: "unhealthy", metrics: { httpStatus: res.status } };
    }
    const body = (await res.json()) as {
      data?: { status?: string; checks?: Record<string, unknown> };
    };
    const data = body.data ?? {};
    const rawStatus = data.status as string | undefined;
    const status: HealthStatus =
      rawStatus === "healthy"
        ? "healthy"
        : rawStatus === "degraded"
          ? "degraded"
          : "unhealthy";
    const metrics: Record<string, unknown> = {};
    if (data.checks) {
      for (const [k, v] of Object.entries(data.checks)) {
        metrics[k] = v;
      }
    }
    return { status, metrics };
  } catch {
    return { status: "offline", metrics: {} };
  }
}

export async function getSystemMap(): Promise<ModuleMapEntry[]> {
  const modules = await prisma.module.findMany({
    orderBy: { name: "asc" },
  });

  const results = await Promise.all(
    modules.map(async (mod) => {
      const lastChecked = new Date().toISOString();
      if (!mod.isActive) {
        return {
          id: mod.id,
          slug: mod.slug,
          name: mod.name,
          description: mod.description,
          isActive: false,
          healthStatus: "offline" as HealthStatus,
          metrics: {},
          lastChecked,
        };
      }
      const { status, metrics } = await fetchModuleHealth(mod.slug);
      return {
        id: mod.id,
        slug: mod.slug,
        name: mod.name,
        description: mod.description,
        isActive: mod.isActive,
        healthStatus: status,
        metrics,
        lastChecked,
      };
    })
  );

  return results;
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export async function getAggregateAnalytics(
  filter: AnalyticsFilter = {}
): Promise<AggregateAnalytics> {
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  weekStart.setHours(0, 0, 0, 0);

  const dateFrom = filter.dateFrom ? new Date(filter.dateFrom) : weekStart;
  const dateTo = filter.dateTo ? new Date(filter.dateTo) : now;

  const in30Days = new Date(now);
  in30Days.setDate(in30Days.getDate() + 30);

  const [
    bookingsTodayTotal,
    bookingsWeekGroups,
    ordersTodayCount,
    ordersTodayAgg,
    ordersWeekAgg,
    activeContractsCount,
    contractsRevenueAgg,
    totalOffices,
    occupiedOffices,
    expiringContracts,
    eventStats,
  ] = await Promise.all([
    prisma.booking.count({
      where: {
        date: { gte: todayStart },
        status: { not: "CANCELLED" },
      },
    }),
    prisma.booking.groupBy({
      by: ["moduleSlug"],
      where: {
        date: { gte: dateFrom, lte: dateTo },
        status: { not: "CANCELLED" },
      },
      _count: { id: true },
    }),
    prisma.order.count({
      where: {
        createdAt: { gte: todayStart },
        status: { not: "CANCELLED" },
      },
    }),
    prisma.order.aggregate({
      where: {
        createdAt: { gte: todayStart },
        status: { not: "CANCELLED" },
      },
      _sum: { totalAmount: true },
    }),
    prisma.order.aggregate({
      where: {
        createdAt: { gte: weekStart },
        status: { not: "CANCELLED" },
      },
      _sum: { totalAmount: true },
    }),
    prisma.rentalContract.count({
      where: { status: { in: ["ACTIVE", "EXPIRING"] } },
    }),
    prisma.rentalContract.aggregate({
      where: { status: { in: ["ACTIVE", "EXPIRING"] } },
      _sum: { monthlyRate: true },
    }),
    prisma.office.count(),
    prisma.office.count({ where: { status: "OCCUPIED" } }),
    prisma.rentalContract.count({
      where: {
        status: { in: ["ACTIVE", "EXPIRING"] },
        endDate: { gte: now, lte: in30Days },
      },
    }),
    getEventStats(),
  ]);

  const byModule: Record<string, number> = {};
  for (const g of bookingsWeekGroups) {
    byModule[g.moduleSlug] = g._count.id;
  }

  const monthlyRevenue = Number(contractsRevenueAgg._sum.monthlyRate ?? 0);
  const occupancyRate =
    totalOffices > 0
      ? Math.round((occupiedOffices / totalOffices) * 100)
      : 0;

  return {
    bookings: {
      todayTotal: bookingsTodayTotal,
      weekTotal: bookingsWeekGroups.reduce((s, g) => s + g._count.id, 0),
      byModule,
    },
    orders: {
      todayCount: ordersTodayCount,
      todayRevenue: Number(ordersTodayAgg._sum.totalAmount ?? 0),
      weekRevenue: Number(ordersWeekAgg._sum.totalAmount ?? 0),
    },
    rental: {
      activeContracts: activeContractsCount,
      monthlyRevenue,
      occupancyRate,
      expiringIn30Days: expiringContracts,
    },
    systemEvents: eventStats,
    generatedAt: now.toISOString(),
  };
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export async function getPaginatedAuditLogs(
  filter: AuditFilter = {}
): Promise<{ logs: AuditLogEntry[]; total: number }> {
  const { userId, entity, action, dateFrom, dateTo, limit = 50, offset = 0 } = filter;

  const where = {
    ...(userId && { userId }),
    ...(entity && { entity }),
    ...(action && { action: { contains: action } }),
    ...(dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom && { gte: new Date(dateFrom) }),
            ...(dateTo && { lte: new Date(dateTo + "T23:59:59.999Z") }),
          },
        }
      : {}),
  };

  const [rawLogs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const logs: AuditLogEntry[] = rawLogs.map((l) => ({
    id: l.id,
    userId: l.userId,
    userName: l.user.name,
    userEmail: l.user.email,
    action: l.action,
    entity: l.entity,
    entityId: l.entityId,
    metadata: l.metadata,
    createdAt: l.createdAt.toISOString(),
  }));

  return { logs, total };
}

// ─── Module Config ────────────────────────────────────────────────────────────

export async function updateModuleConfig(
  id: string,
  patch: ModuleConfigPatch,
  actorUserId: string
): Promise<{ id: string; slug: string; name: string; isActive: boolean; config: unknown }> {
  const existing = await prisma.module.findUnique({ where: { id } });
  if (!existing) {
    throw new ArchitectError("Модуль не найден", "MODULE_NOT_FOUND");
  }

  const updateData: Record<string, unknown> = {};
  if (patch.isActive !== undefined) updateData.isActive = patch.isActive;
  if (patch.config !== undefined) updateData.config = patch.config;

  const updated = await prisma.module.update({
    where: { id },
    data: updateData,
  });

  await logAudit(actorUserId, "module.config.update", "Module", id, {
    before: { isActive: existing.isActive, config: existing.config },
    after: patch,
  });

  if (patch.isActive === false) {
    await log.warn("architect", `Модуль ${existing.slug} отключён`, {
      moduleId: id,
      actorUserId,
    });
  }

  return {
    id: updated.id,
    slug: updated.slug,
    name: updated.name,
    isActive: updated.isActive,
    config: updated.config,
  };
}
