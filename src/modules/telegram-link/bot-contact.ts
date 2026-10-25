import type { TelegramBotContact } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * «Бот запущен / заблокирован» — tracked per Telegram account, not per user,
 * so a contact made before the account was linked is kept (AC-E1.3).
 * One status function for every screen (AC-E1.1).
 * ADR 2026-10-25-team-access-notifications §Q5.
 *
 * Writes are single `INSERT … ON CONFLICT` statements (no read-modify-write
 * races) and best-effort: a failed write must never break the bot or delivery.
 */

export type BotStatus =
  | { state: "NOT_LINKED" }
  | { state: "NOT_STARTED"; trackingSince: Date | null }
  | { state: "STARTED"; startedAt: Date | null }
  | { state: "BLOCKED"; blockedAt: Date };

export type BotStatusDto =
  | { state: "NOT_LINKED" }
  | { state: "NOT_STARTED"; trackingSince: string | null }
  | { state: "STARTED"; startedAt: string | null }
  | { state: "BLOCKED"; blockedAt: string };

export type BotContactSnapshot = Pick<
  TelegramBotContact,
  "startedAt" | "startedBackfill" | "lastContactAt" | "lastDeliveryOkAt" | "blockedAt"
>;

const TELEGRAM_ID_RE = /^[0-9]{1,20}$/;

function latest(...dates: Array<Date | null | undefined>): number {
  return Math.max(0, ...dates.filter((d): d is Date => d instanceof Date).map((d) => d.getTime()));
}

export function computeBotStatus(
  telegramId: string | null,
  contact: BotContactSnapshot | null | undefined,
  trackingSince: Date | null,
): BotStatus {
  if (!telegramId) return { state: "NOT_LINKED" };
  if (contact?.blockedAt && contact.blockedAt.getTime() > latest(contact.lastContactAt, contact.lastDeliveryOkAt)) {
    return { state: "BLOCKED", blockedAt: contact.blockedAt };
  }
  if (contact && (contact.startedAt || contact.startedBackfill || contact.lastDeliveryOkAt)) {
    return { state: "STARTED", startedAt: contact.startedAt };
  }
  return { state: "NOT_STARTED", trackingSince };
}

export function toBotStatusDto(status: BotStatus): BotStatusDto {
  switch (status.state) {
    case "NOT_LINKED":
      return status;
    case "NOT_STARTED":
      return { state: "NOT_STARTED", trackingSince: status.trackingSince?.toISOString() ?? null };
    case "STARTED":
      return { state: "STARTED", startedAt: status.startedAt?.toISOString() ?? null };
    case "BLOCKED":
      return { state: "BLOCKED", blockedAt: status.blockedAt.toISOString() };
  }
}

/** Telegram delivery can't reach this person (blocked or never started). */
export function isBotUnreachable(status: BotStatus): boolean {
  return status.state === "BLOCKED" || status.state === "NOT_STARTED";
}

export async function getBotContacts(telegramIds: string[]): Promise<Map<string, TelegramBotContact>> {
  const ids = [...new Set(telegramIds.filter((id) => TELEGRAM_ID_RE.test(id)))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.telegramBotContact.findMany({ where: { telegramId: { in: ids } } });
  return new Map(rows.map((r) => [r.telegramId, r]));
}

const TRACKING_SINCE_TTL_MS = 10 * 60_000;
let trackingSinceCache: { value: Date | null; at: number } | null = null;

/** When contact tracking started (= migration time); cached in-process for 10 min. */
export async function getBotTrackingSince(): Promise<Date | null> {
  if (trackingSinceCache && Date.now() - trackingSinceCache.at < TRACKING_SINCE_TTL_MS) {
    return trackingSinceCache.value;
  }
  const agg = await prisma.telegramBotContact.aggregate({ _min: { createdAt: true } });
  trackingSinceCache = { value: agg._min.createdAt ?? null, at: Date.now() };
  return trackingSinceCache.value;
}

/** Test hook. */
export function resetBotTrackingSinceCache(): void {
  trackingSinceCache = null;
}

async function safeExecute(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.warn(`[bot-contact] ${label} failed:`, err instanceof Error ? err.message : err);
  }
}

/** Any private-chat contact: first one stamps startedAt (never overwritten), lifts a block. */
export async function recordBotContact(telegramId: string, at: Date = new Date()): Promise<void> {
  if (!TELEGRAM_ID_RE.test(telegramId)) return;
  await safeExecute("recordBotContact", () =>
    prisma.$executeRaw`
      INSERT INTO "TelegramBotContact" ("telegramId", "startedAt", "lastContactAt", "createdAt", "updatedAt")
      VALUES (${telegramId}, ${at}, ${at}, now(), now())
      ON CONFLICT ("telegramId") DO UPDATE SET
        "startedAt" = COALESCE("TelegramBotContact"."startedAt", EXCLUDED."startedAt"),
        "lastContactAt" = GREATEST(COALESCE("TelegramBotContact"."lastContactAt", EXCLUDED."lastContactAt"), EXCLUDED."lastContactAt"),
        "updatedAt" = now()`,
  );
}

/** Telegram reported the bot was blocked/stopped by this user. */
export async function recordBotBlocked(telegramId: string, at: Date = new Date()): Promise<void> {
  if (!TELEGRAM_ID_RE.test(telegramId)) return;
  await safeExecute("recordBotBlocked", () =>
    prisma.$executeRaw`
      INSERT INTO "TelegramBotContact" ("telegramId", "blockedAt", "createdAt", "updatedAt")
      VALUES (${telegramId}, ${at}, now(), now())
      ON CONFLICT ("telegramId") DO UPDATE SET
        "blockedAt" = EXCLUDED."blockedAt",
        "updatedAt" = now()`,
  );
}

/**
 * A message was delivered — proof the bot may write to this user. Throttled to
 * one write per hour unless it clears a recorded block.
 */
export async function recordDeliveryProof(telegramId: string, at: Date = new Date()): Promise<void> {
  if (!TELEGRAM_ID_RE.test(telegramId)) return;
  await safeExecute("recordDeliveryProof", () =>
    prisma.$executeRaw`
      INSERT INTO "TelegramBotContact" ("telegramId", "lastDeliveryOkAt", "createdAt", "updatedAt")
      VALUES (${telegramId}, ${at}, now(), now())
      ON CONFLICT ("telegramId") DO UPDATE SET
        "lastDeliveryOkAt" = EXCLUDED."lastDeliveryOkAt",
        "updatedAt" = now()
      WHERE "TelegramBotContact"."lastDeliveryOkAt" IS NULL
         OR "TelegramBotContact"."lastDeliveryOkAt" < EXCLUDED."lastDeliveryOkAt" - interval '1 hour'
         OR "TelegramBotContact"."blockedAt" > "TelegramBotContact"."lastDeliveryOkAt"`,
  );
}
