import type {
  NotificationChannelKind,
  NotificationEventPreference,
  NotificationGlobalPreference,
} from "@prisma/client";
import { prisma } from "@/lib/db";

export async function getPreferences(userId: string): Promise<{
  global: NotificationGlobalPreference | null;
  events: NotificationEventPreference[];
}> {
  const [global, events] = await Promise.all([
    prisma.notificationGlobalPreference.findUnique({ where: { userId } }),
    prisma.notificationEventPreference.findMany({
      where: { userId },
      orderBy: { eventType: "asc" },
    }),
  ]);
  return { global, events };
}

export async function upsertGlobalPreference(
  userId: string,
  data: {
    timezone?: string;
    quietHoursFrom?: string | null;
    quietHoursTo?: string | null;
    dndUntil?: Date | null;
  }
): Promise<NotificationGlobalPreference> {
  return prisma.notificationGlobalPreference.upsert({
    where: { userId },
    create: {
      userId,
      timezone: data.timezone ?? "Europe/Moscow",
      quietHoursFrom: data.quietHoursFrom ?? null,
      quietHoursTo: data.quietHoursTo ?? null,
      dndUntil: data.dndUntil ?? null,
    },
    update: {
      timezone: data.timezone,
      quietHoursFrom: data.quietHoursFrom,
      quietHoursTo: data.quietHoursTo,
      dndUntil: data.dndUntil,
    },
  });
}

export async function upsertEventPreference(
  userId: string,
  eventType: string,
  data: {
    enabled?: boolean;
    channelKinds?: NotificationChannelKind[];
    quietHoursFrom?: string | null;
    quietHoursTo?: string | null;
    quietWeekdaysOnly?: boolean;
    timezone?: string;
    dndUntil?: Date | null;
  }
): Promise<NotificationEventPreference> {
  return prisma.notificationEventPreference.upsert({
    where: { userId_eventType: { userId, eventType } },
    create: {
      userId,
      eventType,
      enabled: data.enabled ?? true,
      channelKinds: data.channelKinds ?? [],
      quietHoursFrom: data.quietHoursFrom ?? null,
      quietHoursTo: data.quietHoursTo ?? null,
      quietWeekdaysOnly: data.quietWeekdaysOnly ?? false,
      timezone: data.timezone ?? "Europe/Moscow",
      dndUntil: data.dndUntil ?? null,
    },
    update: data,
  });
}
