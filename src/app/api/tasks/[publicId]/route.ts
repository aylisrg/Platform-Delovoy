import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiNotFound,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { UpdateTaskSchema } from "@/modules/tasks/validation";
import {
  getTaskByPublicId,
  cancelTask,
  updateTaskFields,
} from "@/modules/tasks/service";

type TaskGuardShape = {
  assigneeUserId: string | null;
  reporterUserId: string | null;
  categoryId: string | null;
  type: string;
};

/** Can this session READ the task? Managers see own + reporter + ISSUE-by-category. */
function canReadTask(
  role: string,
  userId: string,
  task: TaskGuardShape,
  managerCategoryIds: string[]
): boolean {
  if (role === "SUPERADMIN" || role === "ADMIN") return true;
  if (role === "MANAGER") {
    return (
      task.assigneeUserId === userId ||
      task.reporterUserId === userId ||
      (task.type === "ISSUE" &&
        !!task.categoryId &&
        managerCategoryIds.includes(task.categoryId))
    );
  }
  return false;
}

/**
 * Can this session WRITE editable fields (title/description/priority/…)?
 * Narrower than read: MANAGER must be assignee or reporter. Seeing an ISSUE in
 * your category via `defaultAssignee` does not grant you edit rights on
 * someone else's task (the status + comment endpoints remain available so
 * the MANAGER can still triage).
 */
function canWriteTask(
  role: string,
  userId: string,
  task: TaskGuardShape
): boolean {
  if (role === "SUPERADMIN" || role === "ADMIN") return true;
  if (role === "MANAGER") {
    return (
      task.assigneeUserId === userId || task.reporterUserId === userId
    );
  }
  return false;
}

async function managerCategories(userId: string): Promise<string[]> {
  const cats = await prisma.taskCategory.findMany({
    where: { defaultAssigneeUserId: userId },
    select: { id: true },
  });
  return cats.map((c: { id: string }) => c.id);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ publicId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role === "USER") return apiForbidden();

    const { publicId } = await params;
    const task = await getTaskByPublicId(publicId);
    if (!task) return apiNotFound("Задача не найдена");

    const catIds =
      session.user.role === "MANAGER"
        ? await managerCategories(session.user.id)
        : [];
    if (!canReadTask(session.user.role, session.user.id, task, catIds)) {
      return apiForbidden();
    }

    return apiResponse(task);
  } catch (err) {
    console.error("[GET /api/tasks/:publicId]", err);
    return apiServerError();
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ publicId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role === "USER") return apiForbidden();

    const { publicId } = await params;
    const body = await request.json().catch(() => null);
    if (!body) return apiError("INVALID_JSON", "Неверный JSON", 400);

    const parsed = UpdateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const existing = await prisma.task.findUnique({
      where: { publicId },
      select: {
        id: true,
        assigneeUserId: true,
        reporterUserId: true,
        categoryId: true,
        type: true,
      },
    });
    if (!existing) return apiNotFound("Задача не найдена");

    if (!canWriteTask(session.user.role, session.user.id, existing)) {
      return apiForbidden();
    }

    const updated = await updateTaskFields(
      existing.id,
      {
        title: parsed.data.title,
        description: parsed.data.description,
        priority: parsed.data.priority,
        categoryId: parsed.data.categoryId,
        labels: parsed.data.labels,
        dueDate: parsed.data.dueDate,
        remindAt: parsed.data.remindAt,
        moduleContext: parsed.data.moduleContext,
      },
      { id: session.user.id }
    );

    return apiResponse(updated);
  } catch (err) {
    console.error("[PATCH /api/tasks/:publicId]", err);
    return apiServerError();
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ publicId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role === "USER") return apiForbidden();

    const { publicId } = await params;
    const task = await prisma.task.findUnique({
      where: { publicId },
      select: {
        id: true,
        assigneeUserId: true,
        reporterUserId: true,
        categoryId: true,
        type: true,
      },
    });
    if (!task) return apiNotFound("Задача не найдена");

    if (!canWriteTask(session.user.role, session.user.id, task)) {
      return apiForbidden();
    }

    const cancelled = await cancelTask(task.id, { id: session.user.id });
    return apiResponse(cancelled);
  } catch (err) {
    console.error("[DELETE /api/tasks/:publicId]", err);
    return apiServerError();
  }
}
