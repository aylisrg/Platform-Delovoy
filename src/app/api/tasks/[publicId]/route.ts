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
import { getTaskByPublicId, cancelTask } from "@/modules/tasks/service";
import { logAudit } from "@/lib/logger";

function canReadTask(
  role: string,
  userId: string,
  task: { assigneeUserId: string | null; reporterUserId: string | null; categoryId: string | null; type: string },
  managerCategoryIds: string[]
): boolean {
  if (role === "SUPERADMIN" || role === "ADMIN") return true;
  if (role === "MANAGER") {
    return (
      task.assigneeUserId === userId ||
      task.reporterUserId === userId ||
      (task.type === "ISSUE" && !!task.categoryId && managerCategoryIds.includes(task.categoryId))
    );
  }
  return false;
}

async function managerCategories(userId: string): Promise<string[]> {
  const cats = await prisma.taskCategory.findMany({
    where: { defaultAssigneeUserId: userId },
    select: { id: true },
  });
  return cats.map((c) => c.id);
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

    const catIds =
      session.user.role === "MANAGER"
        ? await managerCategories(session.user.id)
        : [];
    if (!canReadTask(session.user.role, session.user.id, existing, catIds)) {
      return apiForbidden();
    }

    const updated = await prisma.task.update({
      where: { id: existing.id },
      data: {
        title: parsed.data.title,
        description: parsed.data.description ?? undefined,
        priority: parsed.data.priority,
        categoryId: parsed.data.categoryId ?? undefined,
        labels: parsed.data.labels,
        dueDate: parsed.data.dueDate ?? undefined,
        remindAt: parsed.data.remindAt ?? undefined,
        moduleContext: parsed.data.moduleContext ?? undefined,
      },
    });

    await logAudit(session.user.id, "task.update", "Task", updated.id, {
      publicId,
    });

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

    const catIds =
      session.user.role === "MANAGER"
        ? await managerCategories(session.user.id)
        : [];
    if (!canReadTask(session.user.role, session.user.id, task, catIds)) {
      return apiForbidden();
    }

    const cancelled = await cancelTask(task.id, { id: session.user.id });
    return apiResponse(cancelled);
  } catch (err) {
    console.error("[DELETE /api/tasks/:publicId]", err);
    return apiServerError();
  }
}
