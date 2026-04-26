import type {
  NotificationChannelKind,
  NotificationEventPreference,
  NotificationGlobalPreference,
  UserNotificationChannel,
} from "@prisma/client";
import { prisma } from "@/lib/db";

export type EffectivePreference = {
  enabled: boolean;
  channelKinds: NotificationChannelKind[]; // ordered list to try; empty = use user's primary
  quietHoursFrom: string | null;
  quietHoursTo: string | null;
  quietWeekdaysOnly: boolean;
  timezone: string;
  dndUntil: Date | null;
};

export const DEFAULT_TIMEZONE = "Europe/Moscow";

export function mergePreferences(
  global: NotificationGlobalPreference | null,
  perEvent: NotificationEventPreference | null
): EffectivePreference {
  return {
    enabled: perEvent?.enabled ?? true,
    channelKinds: perEvent?.channelKinds ?? [],
    quietHoursFrom: perEvent?.quietHoursFrom ?? global?.quietHoursFrom ?? null,
    quietHoursTo: perEvent?.quietHoursTo ?? global?.quietHoursTo ?? null,
    quietWeekdaysOnly: perEvent?.quietWeekdaysOnly ?? false,
    timezone: perEvent?.timezone ?? global?.timezone ?? DEFAULT_TIMEZONE,
    dndUntil: perEvent?.dndUntil ?? global?.dndUntil ?? null,
  };
}

export async function loadEffectivePreference(
  userId: string,
  eventType: string
): Promise<EffectivePreference> {
  const [global, perEvent] = await Promise.all([
    prisma.notificationGlobalPreference.findUnique({ where: { userId } }),
    prisma.notificationEventPreference.findUnique({
      where: { userId_eventType: { userId, eventType } },
    }),
  ]);
  return mergePreferences(global, perEvent);
}

/**
 * Pick channel for delivery. Returns the first available channel matching:
 *   1) preference.channelKinds (ordered) → first user-channel of that kind
 *      that is verified, active, and registry-available
 *   2) fallback: user's verified+active channel with smallest priority value
 */
export function pickChannel(
  userChannels: UserNotificationChannel[],
  preference: EffectivePreference,
  registryAvailable: (kind: NotificationChannelKind) => boolean
): UserNotificationChannel | null {
  const verified = userChannels
    .filter((c) => c.isActive && c.verifiedAt && registryAvailable(c.kind))
    .sort((a, b) => a.priority - b.priority);

  if (preference.channelKinds.length) {
    for (const kind of preference.channelKinds) {
      const found = verified.find((c) => c.kind === kind);
      if (found) return found;
    }
    return null;
  }
  return verified[0] ?? null;
}
