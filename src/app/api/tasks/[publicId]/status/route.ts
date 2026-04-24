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
import { UpdateStatusSchema } from "@/modules/tasks/validation";
import { updateStatus } from "@/modules/tasks/service";

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

    const parsed = UpdateStatusSchema.safeParse(body);
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

    // MANAGER может менять статус только своих задач (assignee=me или reporter=me)
    // или ISSUE своей категории.
    if (session.user.role === "MANAGER") {
      const myCats = await prisma.taskCategory.findMany({
        where: { defaultAssigneeUserId: session.user.id },
        select: { id: true },
      });
      const myCatIds = myCats.map((c: { id: string }) => c.id);
      const canEdit =
        existing.assigneeUserId === session.user.id ||
        existing.reporterUserId === session.user.id ||
        (existing.type === "ISSUE" &&
          !!existing.categoryId &&
          myCatIds.includes(existing.categoryId));
      if (!canEdit) return apiForbidden();
    }

    const updated = await updateStatus(existing.id, parsed.data.status, {
      id: session.user.id,
    });

    return apiResponse(updated);
  } catch (err) {
    console.error("[PATCH /api/tasks/:publicId/status]", err);
    return apiServerError();
  }
}
