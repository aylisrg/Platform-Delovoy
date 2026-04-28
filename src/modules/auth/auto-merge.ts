/**
 * Auto-merge on login.
 *
 * Wave 2 §3 — when a new sign-in (Telegram bot deep-link, magic-link,
 * future VK ID) finds existing User candidates by phone/email, decide
 * whether to silently fold them together or escalate to manual review.
 *
 * Decision matrix
 *   0 candidates                       → no-op (caller creates the new user)
 *   1 candidate, role = USER           → soft-merge (auth.merge.auto)
 *   1 candidate, role MANAGER/SUPERADMIN/ADMIN
 *                                      → SKIP — admins must never be merged
 *                                        without explicit review (auth.merge.skipped_admin)
 *   ≥2 candidates                      → record MergeCandidate rows for SUPERADMIN
 *                                        review (auth.merge.conflict)
 *
 * "Soft-merge" here uses the same FK-transfer + tombstone scheme as the
 * SUPERADMIN-driven `mergeClients` (Wave 1) — we just call into it.
 * The audit action differs (`auth.merge.auto` vs `auth.merge.manual`)
 * so funnels stay readable.
 *
 * The actor in `mergeClients` is the primary user themselves (the one
 * keeping their account). That keeps the AuditLog row attributable —
 * SUPERADMIN-id would be misleading because no admin is involved.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { mergeClients } from "@/modules/clients/service";
import { logAuthEvent } from "@/lib/audit";

export type AutoMergeCandidate = {
  id: string;
  role: string;
  matchedBy: "phone" | "email" | "telegramId" | "vkId";
};

export type AutoMergeResult =
  | { kind: "no_candidates" }
  | { kind: "merged"; secondaryUserId: string; matchedBy: string }
  | { kind: "skipped_admin"; secondaryUserId: string; role: string }
  | { kind: "conflict"; candidateUserIds: string[] };

export type AutoMergeInput = {
  /** The user the new sign-in resolved to (the survivor) */
  primaryUserId: string;
  /** Other users that match by phone/email/etc — should NOT include primary */
  candidates: AutoMergeCandidate[];
  /** Provider that triggered the merge — for audit metadata only */
  provider: string;
};

const ADMIN_ROLES = new Set(["SUPERADMIN", "ADMIN", "MANAGER"]);

/**
 * Apply the auto-merge decision tree. Idempotent: callers may invoke
 * this every login without checking previous state — duplicate
 * MergeCandidate writes are deduped by `@@unique([primaryUserId,
 * candidateUserId])`.
 *
 * Returns a typed result so callers can react (e.g. tell the bot user
 * "merged your old account" or "we found duplicates — admin will sort
 * it out").
 */
export async function autoMergeOnLogin(
  input: AutoMergeInput,
  /** Optional Prisma transaction client; defaults to the default client */
  tx?: Prisma.TransactionClient | PrismaClient
): Promise<AutoMergeResult> {
  const db = tx ?? prisma;

  // De-dup self and any accidental duplicates in the candidate list.
  const seen = new Set<string>([input.primaryUserId]);
  const unique = input.candidates.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  if (unique.length === 0) {
    return { kind: "no_candidates" };
  }

  // Conflict: more than one distinct other user matched.
  if (unique.length > 1) {
    // Persist MergeCandidate rows so SUPERADMIN can resolve manually.
    // Use upsert to make this idempotent across repeated logins.
    for (const cand of unique) {
      const [a, b] = sortPair(input.primaryUserId, cand.id);
      await db.mergeCandidate.upsert({
        where: { primaryUserId_candidateUserId: { primaryUserId: a, candidateUserId: b } },
        create: {
          primaryUserId: a,
          candidateUserId: b,
          matchedFields: [cand.matchedBy],
          matchScore: 0.9,
          status: "PENDING",
        },
        update: {
          matchedFields: { push: cand.matchedBy },
        },
      });
    }
    await logAuthEvent("auth.merge.conflict", input.primaryUserId, {
      provider: input.provider,
      candidateUserIds: unique.map((c) => c.id),
      matchedBy: unique.map((c) => c.matchedBy).join(","),
    });
    return {
      kind: "conflict",
      candidateUserIds: unique.map((c) => c.id),
    };
  }

  // Exactly one candidate.
  const cand = unique[0];

  if (ADMIN_ROLES.has(cand.role)) {
    await logAuthEvent("auth.merge.skipped_admin", input.primaryUserId, {
      provider: input.provider,
      matchedBy: cand.matchedBy,
      secondaryUserId: cand.id,
      role: cand.role,
    });
    return {
      kind: "skipped_admin",
      secondaryUserId: cand.id,
      role: cand.role,
    };
  }

  // Single USER candidate → soft-merge candidate INTO primary.
  // Reuse Wave 1's mergeClients which handles all FK transfer + tombstone.
  // Note: mergeClients uses its own internal transaction. Calling it from
  // a parent tx is not supported by Prisma — we let it manage its own.
  await mergeClients(input.primaryUserId, cand.id, input.primaryUserId);

  await logAuthEvent("auth.merge.auto", input.primaryUserId, {
    provider: input.provider,
    matchedBy: cand.matchedBy,
    secondaryUserId: cand.id,
  });

  return {
    kind: "merged",
    secondaryUserId: cand.id,
    matchedBy: cand.matchedBy,
  };
}

/** Stable pair ordering so MergeCandidate uniqueness works regardless of arg order. */
function sortPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
