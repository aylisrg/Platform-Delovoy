import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { log } from "@/lib/logger";
import { dispatch } from "./dispatch/dispatcher";
import { resolveStaffRouting } from "./audience";

/** Единственный тип события релиза. `system.deploy` сознательно не вводится (ADR §4). */
export const RELEASE_EVENT_TYPE = "system.release";

export interface ReleaseInfo {
  version: string;
  releaseNotes: string;
  commitSha: string;
  deployedAt: string;
  /** Explicit curated announcement; absent means the legacy once-per-version policy. */
  updateId?: string;
}

export type AnnounceReleaseResult = {
  status: "queued" | "skipped" | "error";
  reason: "queued" | "already-announced" | "in-progress" | "no-recipients" | "suppressed"
    | "claim-failed" | "preflight-failed" | "enqueue-failed" | "outcome-uncertain" | "recording-failed";
  /** New outgoing rows, including deferred rows. This is not a delivery receipt. */
  queued: number;
  deferred: number;
  skipped: number;
  failed: number;
  previouslyQueued: number;
  retryable: boolean;
};

export function normalizeManualReleaseNotes(notes: string): string {
  return notes.normalize("NFC").replace(/\r\n?/g, "\n")
    .split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
}

export function manualReleaseId(notes: string): string {
  return `manual:${createHash("sha256").update(normalizeManualReleaseNotes(notes)).digest("hex")}`;
}

function outcome(status: AnnounceReleaseResult["status"], reason: AnnounceReleaseResult["reason"],
  counts: Partial<Omit<AnnounceReleaseResult, "status" | "reason">> = {}): AnnounceReleaseResult {
  return { status, reason, queued: 0, deferred: 0, skipped: 0, failed: 0, previouslyQueued: 0, retryable: false, ...counts };
}

/** Prisma P2002 — нарушение уникальности (здесь: версия уже анонсирована). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * Legacy announcements remain once per version. Explicit manual notes have a
 * separate content-addressed namespace, independent of SHA/version changes.
 * New claims use source as a durable state; historical rows are never reset.
 * Only known nonqueued outcomes may be retried. Existing outgoing rows prevent
 * replay per recipient beyond the dispatcher's five-minute dedup window.
 * An interrupted/uncertain claim stays blocked for operator diagnosis.
 * See docs/architecture/2026-10-31-curated-release-notifications.md.
 */
export async function announceRelease(
  info: ReleaseInfo
): Promise<AnnounceReleaseResult> {
  if (info.updateId && (!normalizeManualReleaseNotes(info.releaseNotes) || info.updateId !== manualReleaseId(info.releaseNotes))) {
    throw new Error("Invalid curated release identity");
  }
  const key = info.updateId ?? info.version;
  const origin = info.updateId ? "manual" : "deploy";
  const processing = `${origin}:processing`;
  const retryable = `${origin}:retryable`;
  const claimTime = new Date();
  let knownQueued = 0;

  try {
    await prisma.releaseAnnouncement.create({
      data: {
        version: key,
        commitSha: info.commitSha,
        releaseNotes: info.releaseNotes,
        announcedAt: claimTime,
        source: processing,
      },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) {
      await log.warn("release-notify", "Claim релиза не подтверждён — постановка в очередь заблокирована", { key });
      return outcome("error", "claim-failed", { failed: 1 });
    }
    try {
      const existing = await prisma.releaseAnnouncement.findUnique({ where: { version: key } });
      if (!existing) return outcome("error", "claim-failed", { failed: 1 });
      knownQueued = existing.recipientCount;
      if (existing.source === `${origin}:uncertain`) return outcome("error", "outcome-uncertain", { failed: 1, previouslyQueued: existing.recipientCount });
      if (existing.source === processing) {
        // Observability timeout only: it never grants permission to take over.
        const interrupted = Date.now() - existing.announcedAt.getTime() > 15 * 60_000;
        return outcome(interrupted ? "error" : "skipped", interrupted ? "outcome-uncertain" : "in-progress", {
          failed: interrupted ? 1 : 0, previouslyQueued: existing.recipientCount,
        });
      }
      if (existing.source !== retryable) {
        await log.info("release-notify", "Повторный анонс заблокирован; это не подтверждение доставки", { key });
        return outcome("skipped", "already-announced", { previouslyQueued: existing.recipientCount });
      }
      const acquired = await prisma.releaseAnnouncement.updateMany({
        where: { version: key, source: retryable, announcedAt: existing.announcedAt },
        data: { source: processing, announcedAt: claimTime },
      });
      if (acquired.count !== 1) return outcome("skipped", "in-progress");
    } catch {
      return outcome("error", "claim-failed", { failed: 1 });
    }
  }

  const finish = async (state: string, recipientCount: number): Promise<boolean> => {
    try {
      const updated = await prisma.releaseAnnouncement.updateMany({
        where: { version: key, source: processing, announcedAt: claimTime },
        data: { source: `${origin}:${state}`, recipientCount },
      });
      return updated.count === 1;
    } catch { return false; }
  };

  let userIds: string[];
  let previous: Set<string>;
  try {
    // All statuses count: FAILED/SKIPPED rows may have an uncertain external
    // outcome, or belong to a fallback chain owned by the existing dispatcher.
    const rows = await prisma.outgoingNotification.findMany({
      where: { eventType: RELEASE_EVENT_TYPE, entityType: "Release", entityId: key },
      select: { userId: true },
    });
    previous = new Set(rows.map((row) => row.userId));
    if (previous.size < knownQueued) {
      // Deleted/unavailable evidence is not proof that an earlier queue write
      // never happened. Keep that history blocked rather than replay anyone.
      await finish("uncertain", knownQueued);
      return outcome("error", "outcome-uncertain", { failed: 1, previouslyQueued: knownQueued });
    }
    knownQueued = previous.size;
    userIds = [...new Set(await resolveReleaseAudience())].filter((id) => !previous.has(id));
  } catch {
    const recorded = await finish("retryable", knownQueued);
    return outcome("error", recorded ? "preflight-failed" : "recording-failed", { failed: 1, retryable: recorded, previouslyQueued: knownQueued });
  }

  const payload = buildReleasePayload(info);
  const outcomes = await Promise.allSettled(
    userIds.map((userId) =>
      dispatch({
        userId,
        eventType: RELEASE_EVENT_TYPE,
        entityType: "Release",
        entityId: key,
        payload,
      })
    )
  );

  let queued = 0, deferred = 0, skipped = 0, failed = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      failed++;
      continue;
    }
    if (outcome.value.status === "skipped") skipped++;
    else {
      queued++;
      if (outcome.value.status === "deferred") deferred++;
    }
  }

  const canRetry = failed === 0 && (skipped > 0 || (userIds.length === 0 && previous.size === 0));
  const state = failed ? "uncertain" : canRetry ? "retryable" : "complete";
  const counts = { queued, deferred, skipped, failed, previouslyQueued: previous.size, retryable: canRetry };
  if (!await finish(state, previous.size + queued)) {
    return outcome("error", "recording-failed", { ...counts, failed: failed + 1, retryable: false });
  }
  const result = failed ? outcome("error", "enqueue-failed", counts)
    : queued ? outcome("queued", "queued", counts)
      : outcome("skipped", skipped ? "suppressed" : previous.size ? "already-announced" : "no-recipients", counts);
  await log.info("release-notify", "Результат постановки анонса в очередь (не подтверждение доставки)", { key, ...result });
  return result;
}

/**
 * Аудитория релиза — только явные персональные подписки (принцип ADR §3.3:
 * отсутствие строки ≠ подписка), через единый резолвер получателей
 * (ADR 2026-10-25 §Q7): разжалованный или слитый сотрудник выпадает сразу,
 * экран «кто что получает» считает той же функцией.
 */
export async function resolveReleaseAudience(): Promise<string[]> {
  const routing = await resolveStaffRouting({ eventType: RELEASE_EVENT_TYPE, moduleSlug: null });
  return routing.recipients.map((r) => r.userId);
}

/**
 * Список сотрудников и их состояние подписки на релизы для админки.
 * Источник правды — `NotificationEventPreference`; отсутствие строки = не подписан.
 */
export async function getReleaseSubscribers(): Promise<
  Array<{ id: string; notifyReleases: boolean }>
> {
  const users = await prisma.user.findMany({
    where: { role: { not: "USER" }, mergedIntoUserId: null },
    select: {
      id: true,
      notificationEventPrefs: {
        where: { eventType: RELEASE_EVENT_TYPE },
        select: { enabled: true },
      },
    },
  });

  return users.map((u) => ({
    id: u.id,
    notifyReleases: u.notificationEventPrefs[0]?.enabled ?? false,
  }));
}

/**
 * Единственный путь записи подписки на релизы (ADR §6.4).
 *
 * Пишет обе записи: `NotificationEventPreference` — источник правды доставки,
 * легаси-колонка `NotificationPreference.notifyReleases` — зеркало для списка
 * пользователей в `/admin/users`, который читает колонку напрямую. Одна
 * функция — один путь записи, дрейфа между источниками нет.
 */
export async function setReleaseSubscription(
  userId: string,
  enabled: boolean,
  meta: { updatedByUserId?: string; updatedVia?: string } = {}
): Promise<void> {
  const actor = { updatedByUserId: meta.updatedByUserId ?? null, updatedVia: meta.updatedVia ?? null };
  await prisma.notificationEventPreference.upsert({
    where: { userId_eventType: { userId, eventType: RELEASE_EVENT_TYPE } },
    create: { userId, eventType: RELEASE_EVENT_TYPE, enabled, ...actor },
    update: { enabled, ...actor },
  });

  await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, notifyReleases: enabled },
    update: { notifyReleases: enabled },
  });
}

/**
 * Легаси-имя того же действия. Сохранено для существующих импортёров
 * (`PATCH /api/users/:id/notify-releases`), чтобы путь записи остался один.
 */
export const setReleaseNotifyPreference = setReleaseSubscription;

/**
 * Гарантирует, что новый MANAGER/SUPERADMIN подписан на релизы и достижим:
 * строка `system.release` + легаси-строка предпочтений + Telegram-канал
 * доставки при наличии `telegramId`.
 *
 * Идемпотентно и строго create-only: существующая отписка (`enabled: false`)
 * и настройки уже заведённого канала не затираются.
 */
export async function ensureManagerNotifyDefaults(userId: string): Promise<void> {
  await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, notifyReleases: true },
    update: {}, // do not clobber an existing preference
  });

  await prisma.notificationEventPreference.upsert({
    where: { userId_eventType: { userId, eventType: RELEASE_EVENT_TYPE } },
    create: { userId, eventType: RELEASE_EVENT_TYPE, enabled: true, updatedVia: "system" },
    update: {}, // do not clobber an existing opt-out
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramId: true },
  });
  if (!user?.telegramId) return;

  await prisma.userNotificationChannel.upsert({
    where: {
      userId_kind_address: {
        userId,
        kind: "TELEGRAM",
        address: user.telegramId,
      },
    },
    create: {
      userId,
      kind: "TELEGRAM",
      address: user.telegramId,
      label: "Telegram",
      priority: 10,
      isActive: true,
      verifiedAt: new Date(),
    },
    update: {}, // канал уже заведён — не реактивируем и не переверифицируем
  });
}

// ─── Formatter ──────────────────────────────────────────────────────────────

function buildReleasePayload(info: ReleaseInfo): {
  title: string;
  body: string;
  actions: Array<{ label: string; url: string }>;
} {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://delovoy-park.ru";
  return {
    title: `🚀 Релиз v${info.version}`,
    body: formatReleaseBody(info),
    actions: [{ label: "Changelog", url: `${appUrl}/admin/monitoring` }],
  };
}

/** Plain text: Telegram-канал сам экранирует HTML и выделяет заголовок. */
function formatReleaseBody(info: ReleaseInfo): string {
  const shortSha = info.commitSha.slice(0, 7);
  const parsed = new Date(info.deployedAt);
  const date = Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  const head = date
    ? `📅 ${date} МСК  |  🔗 ${shortSha}`
    : `🔗 ${shortSha}`;

  const notes = info.releaseNotes.trim();
  return notes ? `${head}\n\nЧто выкатилось:\n${notes}` : head;
}
