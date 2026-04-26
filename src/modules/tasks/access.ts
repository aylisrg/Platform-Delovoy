import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AccessMode } from "./types";

const ADMIN_ROLES: ReadonlySet<Role> = new Set(["SUPERADMIN", "ADMIN"]);

export async function canAccessTask(
  userId: string,
  role: Role,
  taskId: string,
  mode: AccessMode
): Promise<boolean> {
  if (ADMIN_ROLES.has(role)) return true;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      reporterUserId: true,
      assignees: { select: { userId: true, role: true } },
    },
  });
  if (!task) return false;

  const isAssignee = task.assignees.some((a) => a.userId === userId);
  const isResponsible = task.assignees.some(
    (a) => a.userId === userId && a.role === "RESPONSIBLE"
  );
  const isReporter = task.reporterUserId === userId;

  if (mode === "delete") return false; // только ADMIN+
  if (mode === "manage") return isResponsible; // менять ассайни / категорию
  if (mode === "write") return isAssignee || isReporter;
  if (mode === "read") return isAssignee || isReporter;

  return false;
}

export async function assertTaskAccess(
  userId: string,
  role: Role,
  taskId: string,
  mode: AccessMode
): Promise<void> {
  const ok = await canAccessTask(userId, role, taskId, mode);
  if (!ok) throw new TaskAccessError();
}

export class TaskAccessError extends Error {
  constructor(message = "Нет доступа к задаче") {
    super(message);
    this.name = "TaskAccessError";
  }
}

export class TaskNotFoundError extends Error {
  constructor(message = "Задача не найдена") {
    super(message);
    this.name = "TaskNotFoundError";
  }
}

export class TaskValidationError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "TaskValidationError";
    this.code = code;
    this.details = details;
  }
}

export function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.has(role);
}
