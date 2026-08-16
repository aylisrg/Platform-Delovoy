import type { OutgoingNotification, UserNotificationChannel } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ChannelRegistry } from "./channel-registry";
import { bootstrapChannels } from "./channels";
import { computeDedupKey, isDuplicate } from "./dedup";
import { isInQuietHours, nextQuietHoursEnd } from "./quiet-hours";
import { loadEffectivePreference, pickChannel } from "./preferences";
import type { DispatchEvent, DispatchOutcome } from "./types";
import { log } from "@/lib/logger";
import { EVENT_SOURCES } from "@/lib/event-sources";

bootstrapChannels();

export async function dispatch(event: DispatchEvent): Promise<DispatchOutcome> {
  const dedupKey = computeDedupKey({
    userId: event.userId,
    eventType: event.eventType,
    entityId: event.entityId,
    payload: event.payload,
  });

  if (!event.forceFresh && (await isDuplicate(dedupKey))) {
    return { status: "skipped", reason: "duplicate" };
  }

  const pref = await loadEffectivePreference(event.userId, event.eventType);
  if (!pref.enabled) return { status: "skipped", reason: "preference disabled" };
  if (pref.dndUntil && pref.dndUntil > new Date()) {
    return { status: "skipped", reason: "DND active" };
  }

  const userChannels = await prisma.userNotificationChannel.findMany({
    where: { userId: event.userId, isActive: true },
    orderBy: { priority: "asc" },
  });
  const channel = pickChannel(userChannels, pref, (k) =>
    Boolean(ChannelRegistry.get(k)?.isAvailable())
  );
  if (!channel) return { status: "skipped", reason: "no available channel" };

  const now = new Date();
  const inQuiet = isInQuietHours(now, {
    from: pref.quietHoursFrom,
    to: pref.quietHoursTo,
    timezone: pref.timezone,
    weekdaysOnly: pref.quietWeekdaysOnly,
  });
  const scheduledFor = inQuiet
    ? nextQuietHoursEnd(now, {
        from: pref.quietHoursFrom,
        to: pref.quietHoursTo,
        timezone: pref.timezone,
      })
    : now;

  const outgoing = await prisma.outgoingNotification.create({
    data: {
      userId: event.userId,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      channelId: channel.id,
      payload: event.payload as object,
      status: inQuiet ? "DEFERRED" : "PENDING",
      scheduledFor,
      dedupKey,
      triedChannelIds: [],
    },
  });

  return {
    status: inQuiet ? "deferred" : "queued",
    outgoingId: outgoing.id,
    scheduledFor,
  };
}

/**
 * Process a batch of due notifications. Called by cron.
 * Returns counts of sent/failed for monitoring.
 */
export async function processOutgoing(
  batchSize = 100
): Promise<{ sent: number; failed: number; processed: number }> {
  bootstrapChannels();
  const due = await prisma.outgoingNotification.findMany({
    where: {
      status: { in: ["PENDING", "DEFERRED"] },
      scheduledFor: { lte: new Date() },
    },
    orderBy: { scheduledFor: "asc" },
    take: batchSize,
    include: { channel: true },
  });

  let sent = 0;
  let failed = 0;

  for (const item of due) {
    const result = await deliverOne(item);
    if (result === "sent") sent++;
    else if (result === "failed") failed++;
  }

  return { sent, failed, processed: due.length };
}

type ItemWithChannel = OutgoingNotification & {
  channel: UserNotificationChannel;
};

async function deliverOne(item: ItemWithChannel): Promise<"sent" | "failed" | "retry"> {
  const channel = ChannelRegistry.get(item.channel.kind);
  const unavailable = !channel || !channel.isAvailable();

  if (unavailable) {
    return attemptFallback(item, unavailable ? `channel ${item.channel.kind} unavailable` : "");
  }

  const payload = item.payload as {
    title: string;
    body: string;
    actions?: Array<{ label: string; url?: string }>;
  };
  const result = await channel.send(item.channel.address, {
    title: payload.title,
    body: payload.body,
    actions: payload.actions,
  });

  if (result.ok) {
    await prisma.outgoingNotification.update({
      where: { id: item.id },
      data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 } },
    });
    return "sent";
  }

  const nextAttempts = item.attempts + 1;
  const exhausted = nextAttempts >= item.maxAttempts || !result.retryable;

  if (!exhausted) {
    await prisma.outgoingNotification.update({
      where: { id: item.id },
      data: {
        status: "PENDING",
        failureReason: result.reason,
        attempts: nextAttempts,
        scheduledFor: new Date(Date.now() + 5 * 60_000),
      },
    });
    return "retry";
  }

  return attemptFallback(item, result.reason ?? "exhausted", nextAttempts);
}

async function attemptFallback(
  item: ItemWithChannel,
  reason: string,
  attempts?: number
): Promise<"sent" | "failed"> {
  // Mark current record as failed
  await prisma.outgoingNotification.update({
    where: { id: item.id },
    data: {
      status: "FAILED",
      failureReason: reason,
      attempts: attempts !== undefined ? attempts : { increment: 1 },
    },
  });

  // Collect channels already tried (includes this one)
  const triedIds = [...item.triedChannelIds, item.channelId];

  // Find next available channel for this user by priority, excluding tried ones
  const nextChannel = await prisma.userNotificationChannel.findFirst({
    where: {
      userId: item.userId,
      isActive: true,
      verifiedAt: { not: null },
      id: { notIn: triedIds },
    },
    orderBy: { priority: "asc" },
  });

  if (!nextChannel || !ChannelRegistry.get(nextChannel.kind)?.isAvailable()) {
    // All channels exhausted — log warning via SystemEvent
    await log.warn(
      EVENT_SOURCES.NOTIFICATIONS,
      `All channels exhausted for userId=${item.userId} eventType=${item.eventType}`,
      { outgoingId: item.id, triedIds }
    );
    return "failed";
  }

  // Enqueue fallback attempt
  await prisma.outgoingNotification.create({
    data: {
      userId: item.userId,
      eventType: item.eventType,
      entityType: item.entityType,
      entityId: item.entityId,
      channelId: nextChannel.id,
      payload: item.payload as object,
      status: "PENDING",
      scheduledFor: new Date(),
      dedupKey: item.dedupKey,
      triedChannelIds: triedIds,
      fallbackOfId: item.fallbackOfId ?? item.id,
      maxAttempts: item.maxAttempts,
    },
  });

  return "failed"; // current item failed; fallback queued
}

export const NotificationDispatcher = { dispatch, processOutgoing };
