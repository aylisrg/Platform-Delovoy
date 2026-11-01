import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { maskChatId } from "@/lib/audit";
import { mergeError } from "./merge-errors";
import type { AccountBrief, MergeRequestItem } from "./types";

/**
 * «Запросы на объединение» (ADR 2026-10-25-team-access-notifications §3.1,
 * §5.4; PRD US-E4). A request is a `MergeCandidate` row with
 * `matchedFields = ["telegramId"]`, `matchScore = 1`; the pair is ordered by
 * `sortPair` (same as `autoMergeOnLogin`), so one row per pair exists.
 *
 * Requests are created only after the person proved ownership (correct OTP
 * code or a web session + bot) — strangers can't flood the queue against
 * someone else's email. A per-Telegram Redis limit caps it anyway.
 */

export const MERGE_REQUEST_REASON_FIELD = "telegramId";
export const MERGE_REQUEST_LIMIT_PER_DAY = 3;
const LIMIT_WINDOW_SECONDS = 24 * 3600;

export const MERGE_REQUEST_CREATED_ACTION = "user.merge_request.created";
export const MERGE_REQUEST_DISMISSED_ACTION = "user.merge_request.dismissed";

const CLOSED_FOR_GOOD = new Set(["RESOLVED_KEPT_SEPARATE", "RESOLVED_MERGED"]);

const REASON_LABELS: Record<string, string> = {
  telegramId: "Telegram уже привязан к другому аккаунту",
  phoneNormalized: "Совпадает телефон",
  phone: "Совпадает телефон",
  email: "Совпадает email",
  emailNormalized: "Совпадает email",
  vkId: "Совпадает VK",
};

/** Stable pair ordering so MergeCandidate uniqueness works regardless of arg order. */
export function sortPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function limitKey(telegramId: string): string {
  return `merge-req:tg:${telegramId}`;
}

/**
 * Per-Telegram limit (AC-E4.2). Fail-open on a Redis outage: requests are
 * only reachable after a verified ownership proof.
 */
async function consumeLimit(telegramId: string): Promise<boolean> {
  try {
    const key = limitKey(telegramId);
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, LIMIT_WINDOW_SECONDS);
    return count <= MERGE_REQUEST_LIMIT_PER_DAY;
  } catch {
    return true;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === "P2002";
}

/**
 * Open a merge request for the pair (AC-E4.2/AC-E4.4).
 * - `"exists"` — an open request for the pair already exists (either order);
 * - `"suppressed"` — the pair was closed as «разные люди» / merged, one side is
 *   merged or missing, or the Telegram exceeded its daily limit;
 * - `"created"` — new PENDING row + `user.merge_request.created` (actor = userA).
 */
export async function createMergeRequest(input: {
  userAId: string;
  userBId: string;
  reason: "telegram_conflict";
  telegramId: string;
}): Promise<"created" | "exists" | "suppressed"> {
  const { userAId, userBId, telegramId } = input;
  if (userAId === userBId) return "suppressed";
  const [first, second] = sortPair(userAId, userBId);

  const users = await prisma.user.findMany({
    where: { id: { in: [first, second] } },
    select: { id: true, mergedIntoUserId: true },
  });
  if (users.length !== 2 || users.some((u) => u.mergedIntoUserId)) return "suppressed";

  const existing = await prisma.mergeCandidate.findMany({
    where: {
      OR: [
        { primaryUserId: first, candidateUserId: second },
        { primaryUserId: second, candidateUserId: first },
      ],
    },
    select: { id: true, status: true, primaryUserId: true, candidateUserId: true },
  });
  if (existing.some((r) => CLOSED_FOR_GOOD.has(r.status))) return "suppressed";
  if (existing.some((r) => r.status === "PENDING")) return "exists";

  if (!(await consumeLimit(telegramId))) return "suppressed";

  // A DISMISSED row (closed by an unrelated merge, not by «разные люди») is
  // reopened — the unique pair key leaves no room for a second row.
  const reopen = existing.find((r) => r.primaryUserId === first && r.candidateUserId === second);
  try {
    await prisma.$transaction(async (tx) => {
      const data = {
        matchedFields: [MERGE_REQUEST_REASON_FIELD],
        matchScore: 1,
        status: "PENDING",
        detectedAt: new Date(),
        resolvedAt: null,
        resolvedByUserId: null,
      };
      const saved = reopen
        ? await tx.mergeCandidate.update({ where: { id: reopen.id }, data, select: { id: true } })
        : await tx.mergeCandidate.create({
            data: { primaryUserId: first, candidateUserId: second, ...data },
            select: { id: true },
          });
      await tx.auditLog.create({
        data: {
          userId: userAId,
          action: MERGE_REQUEST_CREATED_ACTION,
          entity: "MergeCandidate",
          entityId: saved.id,
          metadata: {
            reason: input.reason,
            userAId,
            userBId,
            telegramIdMasked: maskChatId(telegramId) ?? null,
            reopened: Boolean(reopen),
          },
        },
      });
    });
    return "created";
  } catch (err) {
    // Two parallel confirmations of the same pair: the other one won.
    if (isUniqueViolation(err)) return "exists";
    throw err;
  }
}

const BRIEF_SELECT = {
  id: true,
  name: true,
  role: true,
  email: true,
  phone: true,
  telegramId: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type BriefRow = Prisma.UserGetPayload<{ select: typeof BRIEF_SELECT }>;

function toBrief(u: BriefRow): AccountBrief {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    email: u.email,
    phone: u.phone,
    hasTelegram: Boolean(u.telegramId),
    createdAt: u.createdAt.toISOString(),
  };
}

function pendingWhere(userId?: string): Prisma.MergeCandidateWhereInput {
  return {
    status: "PENDING",
    matchedFields: { has: MERGE_REQUEST_REASON_FIELD },
    primary: { mergedIntoUserId: null },
    candidate: { mergedIntoUserId: null },
    ...(userId ? { OR: [{ primaryUserId: userId }, { candidateUserId: userId }] } : {}),
  };
}

/** Open requests, oldest first (target: none older than 7 days). */
export async function listMergeRequests(q: { status?: "PENDING"; userId?: string } = {}): Promise<MergeRequestItem[]> {
  const rows = await prisma.mergeCandidate.findMany({
    where: pendingWhere(q.userId),
    orderBy: { detectedAt: "asc" },
    take: 200,
    select: {
      id: true,
      detectedAt: true,
      matchedFields: true,
      primary: { select: BRIEF_SELECT },
      candidate: { select: BRIEF_SELECT },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    detectedAt: r.detectedAt.toISOString(),
    matchedFields: r.matchedFields,
    reasonLabel:
      r.matchedFields.map((f) => REASON_LABELS[f]).find((label): label is string => Boolean(label)) ??
      "Возможный дубль",
    users: [toBrief(r.primary), toBrief(r.candidate)],
  }));
}

export async function countPendingMergeRequests(): Promise<number> {
  return prisma.mergeCandidate.count({ where: pendingWhere() });
}

/**
 * «Это разные люди» (AC-E4.3): closes the request for good — the pair is not
 * offered again (AC-E4.4). 404 unknown, 409 already closed.
 */
export async function dismissMergeRequest(id: string, actorId: string): Promise<{ id: string; status: "RESOLVED_KEPT_SEPARATE" }> {
  const row = await prisma.mergeCandidate.findUnique({
    where: { id },
    select: { id: true, status: true, primaryUserId: true, candidateUserId: true },
  });
  if (!row) throw mergeError("MERGE_REQUEST_NOT_FOUND");
  if (row.status !== "PENDING") throw mergeError("MERGE_REQUEST_CLOSED");

  await prisma.$transaction(async (tx) => {
    const updated = await tx.mergeCandidate.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "RESOLVED_KEPT_SEPARATE", resolvedAt: new Date(), resolvedByUserId: actorId },
    });
    if (updated.count === 0) throw mergeError("MERGE_REQUEST_CLOSED");
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: MERGE_REQUEST_DISMISSED_ACTION,
        entity: "MergeCandidate",
        entityId: id,
        metadata: { userAId: row.primaryUserId, userBId: row.candidateUserId },
      },
    });
  });
  return { id, status: "RESOLVED_KEPT_SEPARATE" };
}
