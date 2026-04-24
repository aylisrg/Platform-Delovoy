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
import { UpdateCategorySchema } from "@/modules/tasks/validation";
import { logAudit } from "@/lib/logger";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") {
      return apiForbidden("Только SUPERADMIN может управлять категориями");
    }

    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body) return apiError("INVALID_JSON", "Неверный JSON", 400);

    const parsed = UpdateCategorySchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const existing = await prisma.taskCategory.findUnique({ where: { id } });
    if (!existing) return apiNotFound("Категория не найдена");

    const updated = await prisma.taskCategory.update({
      where: { id },
      data: parsed.data,
    });

    await logAudit(session.user.id, "task.category.update", "TaskCategory", id);

    return apiResponse(updated);
  } catch (err) {
    console.error("[PATCH /api/tasks/categories/:id]", err);
    return apiServerError();
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") {
      return apiForbidden("Только SUPERADMIN может управлять категориями");
    }

    const { id } = await params;

    // Soft-delete: deactivate rather than remove (tasks reference it by categoryId).
    const updated = await prisma.taskCategory.update({
      where: { id },
      data: { isActive: false },
    });

    await logAudit(session.user.id, "task.category.delete", "TaskCategory", id);

    return apiResponse(updated);
  } catch (err) {
    console.error("[DELETE /api/tasks/categories/:id]", err);
    return apiServerError();
  }
}
