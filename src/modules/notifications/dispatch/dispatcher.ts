import type { OutgoingNotification, UserNotificationChannel } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ChannelRegistry } from "./channel-registry";
import { bootstrapChannels } from "./channels";
import { computeDedupKey, isDuplicate } from "./dedup";
import { isInQuietHours, nextQuietHoursEnd } from "./quiet-hours";
import { loadEffectivePreference, pickChannel } from "./preferences";
import type { DeliveryFailureCode, DispatchEvent, DispatchOutcome } from "./types";
import { log } from "@/lib/logger";
import { EVENT_SOURCES } from "@/lib/event-sources";
import { MANAGED_EVENT_TYPES } from "../catalog";
import { recordSkip, type SkipReason } from "../skips";
import { ensureLinksForDelivery } from "../tracking/link-service";
import { recordBotBlocked, recordDeliveryProof } from "@/modules/telegram-link/bot-contact";

const MANAGED = new Set<string>(MANAGED_EVENT_TYPES);
/** External channels whose buttons go through `/r/{code}` (ADR 2026-10-25 §Q4). */
const TRACKED_KINDS = new Set(["TELEGRAM", "PUSH", "EMAIL"]);

bootstrapChannels();

export async function dispatch(event: DispatchEvent): Promise<DispatchOutcome> {
  const dedupKey = computeDedupKey({
    userId: event.userId,
    eventType: event.eventType,
    entityId: event.entityId,
    payload: event.payload,
  });

  // Skips of staff (catalog) events are recorded so «почему не пришло» has
  // an answer (AC-D4.3); recordSkip ignores other event types.
  const skip = async (reason: SkipReason, message: string): Promise<DispatchOutcome> => {
    await recordSkip({
      userId: event.userId,
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      reason,
    });
    return { status: "skipped", reason: message };
  };

  if (!event.forceFresh && (await isDuplicate(dedupKey))) {
    return skip("DUPLICATE", "duplicate");
  }

  const pref = await loadEffectivePreference(event.userId, event.eventType);
  if (!pref.enabled) return skip("PREFERENCE_DISABLED", "preference disabled");
  if (pref.dndUntil && pref.dndUntil > new Date()) {
    return skip("DND", "DND active");
  }

  const userChannels = await prisma.userNotificationChannel.findMany({
    where: { userId: event.userId, isActive: true },
    orderBy: { priority: "asc" },
  });
  const channel = pickChannel(userChannels, pref, (k) =>
    Boolean(ChannelRegistry.get(k)?.isAvailable())
  );
  if (!channel) return skip("NO_CHANNEL", "no available channel");

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
 * Max age of a queued notification. Anything whose scheduledFor is older
 * than this is marked SKIPPED instead of being sent: after a cron outage the
 * queue may contain confirmations/reminders for bookings that already passed
 * (#917). scheduledFor is used (not createdAt) because DEFERRED items are
 * legitimately created earlier and due at the end of quiet hours.
 */
export const OUTGOING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const STALE_SKIP_REASON = "stale: older than 24h, not sent";

/**
 * Аренда записи на время отправки (#708/#917). Крон стреляет каждую минуту, а
 * одна отправка в Telegram при обрыве VPS -> api.telegram.org висит до таймаута,
 * поэтому прогоны накладываются. Перед отправкой запись атомарно «занимается»:
 * scheduledFor сдвигается на now + lease при условии, что status и scheduledFor
 * не изменились с момента выборки. Второй прогон получает count=0 и пропускает
 * запись (нет дублей). Если процесс умер посреди отправки, запись остаётся
 * PENDING/DEFERRED и сама возвращается в выборку после истечения аренды.
 * Новой колонки и миграции не нужно.
 */
export const OUTGOING_CLAIM_LEASE_MS = 5 * 60_000;

/** Ретрай с экспоненциальной паузой: 5, 10, 20 ... мин, не больше часа. */
export const RETRY_BASE_MS = 5 * 60_000;
export const RETRY_MAX_MS = 60 * 60_000;
export function retryDelayMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(RETRY_BASE_MS * 2 ** (n - 1), RETRY_MAX_MS);
}

/**
 * Process a batch of due notifications. Called by cron.
 * Returns counts of sent/failed for monitoring.
 */
export async function processOutgoing(
  batchSize = 100
): Promise<{ sent: number; failed: number; skipped: number; processed: number }> {
  bootstrapChannels();
  const now = new Date();
  const cutoff = new Date(now.getTime() - OUTGOING_MAX_AGE_MS);
  const due = await prisma.outgoingNotification.findMany({
    where: {
      status: { in: ["PENDING", "DEFERRED"] },
      scheduledFor: { lte: now },
    },
    orderBy: { scheduledFor: "asc" },
    take: batchSize,
    include: { channel: true },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of due) {
    // Boundary: exactly OUTGOING_MAX_AGE_MS old is still sent; strictly older is skipped.
    if (item.scheduledFor.getTime() < cutoff.getTime()) {
      await prisma.outgoingNotification.update({
        where: { id: item.id },
        data: { status: "SKIPPED", failureReason: STALE_SKIP_REASON, failureCode: "STALE" },
      });
      skipped++;
      continue;
    }
    const claimed = await prisma.outgoingNotification.updateMany({
      where: { id: item.id, status: item.status, scheduledFor: item.scheduledFor },
      data: { scheduledFor: new Date(Date.now() + OUTGOING_CLAIM_LEASE_MS) },
    });
    if (claimed.count === 0) continue; // занята параллельным прогоном
    let result: "sent" | "failed" | "retry";
    try {
      result = await deliverOne(item);
    } catch (err) {
      // Не роняем весь батч из-за одной записи: она вернётся после аренды.
      failed++;
      await log.error(
        EVENT_SOURCES.NOTIFICATIONS,
        `processOutgoing: delivery threw for outgoingId=${item.id}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }
    if (result === "sent") sent++;
    else if (result === "failed") failed++;
  }

  if (skipped > 0) {
    await log.warn(
      EVENT_SOURCES.NOTIFICATIONS,
      `processOutgoing: skipped ${skipped} stale notification(s) older than 24h`
    );
  }

  return { sent, failed, skipped, processed: due.length };
}

type ItemWithChannel = OutgoingNotification & {
  channel: UserNotificationChannel;
};

async function deliverOne(item: ItemWithChannel): Promise<"sent" | "failed" | "retry"> {
  const channel = ChannelRegistry.get(item.channel.kind);
  const unavailable = !channel || !channel.isAvailable();

  if (unavailable) {
    return attemptFallback(item, `channel ${item.channel.kind} unavailable`, undefined, "CHANNEL_UNAVAILABLE");
  }

  const payload = item.payload as {
    title: string;
    body: string;
    actions?: Array<{ label: string; url?: string }>;
  };

  // Staff events on external channels: buttons → tracking links (the payload
  // keeps the original URLs for the Mini App feed). If links can't be created
  // the message still goes out with the original buttons.
  let actions = payload.actions;
  if (TRACKED_KINDS.has(item.channel.kind) && MANAGED.has(item.eventType)) {
    try {
      actions = await ensureLinksForDelivery(item, payload.actions);
    } catch (err) {
      await log.warn(
        EVENT_SOURCES.NOTIFICATIONS,
        `deliverOne: tracking links failed for outgoingId=${item.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const result = await channel.send(item.channel.address, {
    title: payload.title,
    body: payload.body,
    actions,
  });

  const isTelegram = item.channel.kind === "TELEGRAM";
  if (result.ok) {
    await prisma.outgoingNotification.update({
      where: { id: item.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        attempts: { increment: 1 },
        externalId: result.externalId ?? null,
      },
    });
    if (isTelegram) await recordDeliveryProof(item.channel.address);
    return "sent";
  }

  const failureCode: DeliveryFailureCode = result.code ?? "OTHER";
  if (isTelegram && failureCode === "BOT_BLOCKED") await recordBotBlocked(item.channel.address);

  const nextAttempts = item.attempts + 1;
  const exhausted = nextAttempts >= item.maxAttempts || !result.retryable;

  if (!exhausted) {
    await prisma.outgoingNotification.update({
      where: { id: item.id },
      data: {
        status: "PENDING",
        failureReason: result.reason,
        failureCode,
        attempts: nextAttempts,
        scheduledFor: new Date(Date.now() + retryDelayMs(nextAttempts)),
      },
    });
    return "retry";
  }

  return attemptFallback(item, result.reason ?? "exhausted", nextAttempts, failureCode);
}

async function attemptFallback(
  item: ItemWithChannel,
  reason: string,
  attempts?: number,
  failureCode: DeliveryFailureCode = "OTHER"
): Promise<"sent" | "failed"> {
  // Mark current record as failed
  await prisma.outgoingNotification.update({
    where: { id: item.id },
    data: {
      status: "FAILED",
      failureReason: reason,
      failureCode,
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
