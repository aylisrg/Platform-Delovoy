import type { OutgoingNotification } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ChannelRegistry } from "./channel-registry";
import { bootstrapChannels } from "./channels";
import { computeDedupKey, isDuplicate } from "./dedup";
import { isInQuietHours, nextQuietHoursEnd } from "./quiet-hours";
import { loadEffectivePreference, pickChannel } from "./preferences";
import type { DispatchEvent, DispatchOutcome } from "./types";

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

async function deliverOne(
  item: OutgoingNotification & { channel: { kind: import("@prisma/client").NotificationChannelKind; address: string } }
): Promise<"sent" | "failed" | "retry"> {
  const channel = ChannelRegistry.get(item.channel.kind);
  if (!channel) {
    await prisma.outgoingNotification.update({
      where: { id: item.id },
      data: {
        status: "FAILED",
        failureReason: `channel ${item.channel.kind} not registered`,
        attempts: { increment: 1 },
      },
    });
    return "failed";
  }

  if (!channel.isAvailable()) {
    await prisma.outgoingNotification.update({
      where: { id: item.id },
      data: {
        status: "FAILED",
        failureReason: `channel ${item.channel.kind} unavailable`,
        attempts: { increment: 1 },
      },
    });
    return "failed";
  }

  const payload = item.payload as { title: string; body: string; actions?: Array<{ label: string; url?: string }> };
  const result = await channel.send(item.channel.address, {
    title: payload.title,
    body: payload.body,
    actions: payload.actions,
  });

  if (result.ok) {
    await prisma.outgoingNotification.update({
      where: { id: item.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    return "sent";
  }

  const nextAttempts = item.attempts + 1;
  const exhausted = nextAttempts >= item.maxAttempts || !result.retryable;
  await prisma.outgoingNotification.update({
    where: { id: item.id },
    data: {
      status: exhausted ? "FAILED" : "PENDING",
      failureReason: result.reason,
      attempts: nextAttempts,
      // retry in 5 minutes
      scheduledFor: exhausted ? item.scheduledFor : new Date(Date.now() + 5 * 60_000),
    },
  });
  return exhausted ? "failed" : "retry";
}

export const NotificationDispatcher = { dispatch, processOutgoing };
