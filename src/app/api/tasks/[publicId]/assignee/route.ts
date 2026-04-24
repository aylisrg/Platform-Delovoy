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
import { UpdateAssigneeSchema } from "@/modules/tasks/validation";
import { updateAssignee } from "@/modules/tasks/service";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ publicId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN" && session.user.role !== "ADMIN") {
      return apiForbidden("Менять исполнителя может только администратор");
    }

    const { publicId } = await params;
    const body = await request.json().catch(() => null);
    if (!body) return apiError("INVALID_JSON", "Неверный JSON", 400);

    const parsed = UpdateAssigneeSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const existing = await prisma.task.findUnique({
      where: { publicId },
      select: { id: true },
    });
    if (!existing) return apiNotFound("Задача не найдена");

    // Verify target user exists (if not null) and isn't a plain USER role
    if (parsed.data.assigneeUserId) {
      const target = await prisma.user.findUnique({
        where: { id: parsed.data.assigneeUserId },
        select: { role: true },
      });
      if (!target) return apiNotFound("Пользователь не найден");
      if (target.role === "USER") {
        return apiError(
          "INVALID_ASSIGNEE",
          "Нельзя назначить задачу обычному пользователю",
          400
        );
      }
    }

    const updated = await updateAssignee(
      existing.id,
      parsed.data.assigneeUserId,
      { id: session.user.id }
    );
    return apiResponse(updated);
  } catch (err) {
    console.error("[PATCH /api/tasks/:publicId/assignee]", err);
    return apiServerError();
  }
}
