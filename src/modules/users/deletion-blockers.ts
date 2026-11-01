import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DeletionBlocker } from "./types";

/**
 * Registry of relations that keep a `User` row from being hard-deleted
 * (ADR 2026-10-25-team-access-notifications §5.1, PRD AC-A3.1/AC-A3.2).
 *
 * Every FK `REFERENCES "User"("id") ON DELETE RESTRICT | NO ACTION` in
 * `prisma/migrations` must be listed in some entry's `tables` — the test
 * `deletion-blockers.test.ts` parses the migrations and fails CI on a new
 * uncovered RESTRICT relation. Indirect blockers (OutgoingNotification via the
 * user's cascading UserNotificationChannel) are listed too: they block the
 * delete just the same.
 *
 * Order = display order in the «Удалить нельзя» dialog.
 */

type BlockerDb = PrismaClient | Prisma.TransactionClient;

export interface DeletionBlockerDefinition {
  type: string;
  label: string;
  /** Tables whose RESTRICT FK to "User" this entry accounts for. */
  tables: string[];
  count: (db: BlockerDb, userId: string) => Promise<number>;
}

export const DELETION_BLOCKERS: DeletionBlockerDefinition[] = [
  {
    type: "AuditLog",
    label: "Журнал действий",
    tables: ["AuditLog"],
    count: (db, userId) => db.auditLog.count({ where: { userId } }),
  },
  {
    type: "ModuleAssignment",
    label: "Назначения на модули",
    tables: ["ModuleAssignment"],
    count: (db, userId) => db.moduleAssignment.count({ where: { userId } }),
  },
  {
    type: "TaskAssignee",
    label: "Задачи",
    tables: ["TaskAssignee"],
    count: (db, userId) => db.taskAssignee.count({ where: { userId } }),
  },
  {
    type: "FeedbackItem",
    label: "Обратная связь",
    tables: ["FeedbackItem"],
    count: (db, userId) => db.feedbackItem.count({ where: { userId } }),
  },
  {
    type: "Subscription",
    label: "Абонементы Плей Парка",
    tables: ["Subscription"],
    count: (db, userId) => db.subscription.count({ where: { userId } }),
  },
  {
    type: "Chat",
    label: "Чаты и сообщения",
    tables: ["Chat", "ChatParticipant", "ChatMessage", "ChatMessageReceipt"],
    count: async (db, userId) => {
      const created = await db.chat.count({ where: { createdByUserId: userId } });
      const participations = await db.chatParticipant.count({ where: { userId } });
      const messages = await db.chatMessage.count({ where: { senderUserId: userId } });
      const receipts = await db.chatMessageReceipt.count({ where: { userId } });
      return created + participations + messages + receipts;
    },
  },
  {
    type: "MergeCandidate",
    label: "Кандидаты на объединение",
    tables: ["MergeCandidate"],
    count: (db, userId) =>
      db.mergeCandidate.count({
        where: { OR: [{ primaryUserId: userId }, { candidateUserId: userId }] },
      }),
  },
  {
    type: "OutgoingNotification",
    label: "Доставленные уведомления",
    tables: ["OutgoingNotification"],
    // RESTRICT on OutgoingNotification.channelId → the user's channels cascade
    // from User, so these rows block the delete indirectly.
    count: (db, userId) => db.outgoingNotification.count({ where: { channel: { userId } } }),
  },
];

/**
 * «Служебные» blockers: they do not make a Telegram-only account a person
 * with history (used by isDisposableTelegramShell, ADR §Q9).
 */
export const SHELL_IGNORED_BLOCKERS: ReadonlySet<string> = new Set([
  "AuditLog",
  "OutgoingNotification",
  "MergeCandidate",
]);

/** Fallback when the DB rejected the delete but no registry entry explains why (AC-A3.2). */
export const UNKNOWN_BLOCKER: DeletionBlocker = {
  type: "Other",
  label: "Связанные записи",
  count: 1,
};

/** Blockers with at least one row, in registry order. Zero counts are hidden. */
export async function getDeletionBlockers(
  userId: string,
  db: BlockerDb = prisma,
): Promise<DeletionBlocker[]> {
  const result: DeletionBlocker[] = [];
  for (const blocker of DELETION_BLOCKERS) {
    const count = await blocker.count(db, userId);
    if (count > 0) result.push({ type: blocker.type, label: blocker.label, count });
  }
  return result;
}
