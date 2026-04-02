import { prisma } from "@/lib/db";
import type { EventLevel } from "@prisma/client";

export async function getRecentEvents(options?: {
  level?: EventLevel;
  source?: string;
  limit?: number;
  offset?: number;
}) {
  const { level, source, limit = 50, offset = 0 } = options ?? {};

  const where = {
    ...(level && { level }),
    ...(source && { source }),
  };

  const [events, total] = await Promise.all([
    prisma.systemEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.systemEvent.count({ where }),
  ]);

  return { events, total };
}

export async function getEventStats() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const [last24h, lastHour, criticalCount] = await Promise.all([
    prisma.systemEvent.count({
      where: { createdAt: { gte: oneDayAgo } },
    }),
    prisma.systemEvent.count({
      where: { createdAt: { gte: oneHourAgo } },
    }),
    prisma.systemEvent.count({
      where: {
        level: { in: ["ERROR", "CRITICAL"] },
        createdAt: { gte: oneDayAgo },
      },
    }),
  ]);

  return { last24h, lastHour, criticalCount };
}

export async function getRecentAuditLogs(options?: {
  userId?: string;
  entity?: string;
  limit?: number;
}) {
  const { userId, entity, limit = 50 } = options ?? {};

  return prisma.auditLog.findMany({
    where: {
      ...(userId && { userId }),
      ...(entity && { entity }),
    },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
