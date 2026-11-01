import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DELETION_BLOCKERS, SHELL_IGNORED_BLOCKERS } from "./deletion-blockers";

/**
 * «Одноразовая оболочка» (ADR 2026-10-25-team-access-notifications §Q9):
 * the account the Mini App created by `telegramId` on first open, with nothing
 * to transfer. Only such an account may be folded into the email account by
 * the self-link (`mergeAccounts(mode: "self_link")`) — anything with history
 * goes to the SUPERADMIN merge-request queue instead, so a single email code
 * can never absorb someone else's history.
 *
 * Shell = role USER, not merged, no email and no password, and no history:
 * none of the deletion blockers except the «служебные» ones
 * (`SHELL_IGNORED_BLOCKERS`: journal, delivered notifications, merge
 * candidates), plus no bookings, orders and reported tasks.
 */
export async function isDisposableTelegramShell(
  userId: string,
  db: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, mergedIntoUserId: true, email: true, passwordHash: true },
  });
  if (!user || user.role !== "USER" || user.mergedIntoUserId) return false;
  if (user.email || user.passwordHash) return false;

  for (const blocker of DELETION_BLOCKERS) {
    if (SHELL_IGNORED_BLOCKERS.has(blocker.type)) continue;
    if ((await blocker.count(db, userId)) > 0) return false;
  }

  const [bookings, orders, reportedTasks] = await Promise.all([
    db.booking.count({ where: { userId } }),
    db.order.count({ where: { userId } }),
    db.task.count({ where: { reporterUserId: userId } }),
  ]);
  return bookings === 0 && orders === 0 && reportedTasks === 0;
}
