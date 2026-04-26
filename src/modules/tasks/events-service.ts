import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  TaskAccessError,
  TaskNotFoundError,
  canAccessTask,
} from "./access";

export async function listEvents(
  publicId: string,
  ctx: { actorUserId: string; actorRole: Role }
) {
  const task = await prisma.task.findUnique({
    where: { publicId },
    select: { id: true, deletedAt: true },
  });
  if (!task || task.deletedAt) throw new TaskNotFoundError();
  const can = await canAccessTask(ctx.actorUserId, ctx.actorRole, task.id, "read");
  if (!can) throw new TaskAccessError();

  return prisma.taskEvent.findMany({
    where: { taskId: task.id },
    include: { actor: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
}
