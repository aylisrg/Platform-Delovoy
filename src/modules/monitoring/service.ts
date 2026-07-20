import { prisma } from "@/lib/db";
import type { EventLevel } from "@prisma/client";
import type { ClientErrorInput } from "./validation";

/**
 * Пишет ошибку клиентского бикона в SystemEvent (level WARNING, source
 * "client-beacon"). Даёт мониторингу видеть, что именно падает в браузерах
 * пользователей (инцидент 2026-07-20: клиентские причины «вечной загрузки»
 * были невидимы серверным пробам).
 */
export async function logClientError(input: ClientErrorInput) {
  await prisma.systemEvent.create({
    data: {
      level: "WARNING",
      source: "client-beacon",
      message: input.message,
      metadata: {
        beaconSource: input.source,
        ...(input.url ? { url: input.url } : {}),
        ...(input.userAgent ? { userAgent: input.userAgent } : {}),
      },
    },
  });
}

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
  offset?: number;
}) {
  const { userId, entity, limit = 50, offset = 0 } = options ?? {};

  const where = {
    ...(userId && { userId }),
    ...(entity && { entity }),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, total };
}
