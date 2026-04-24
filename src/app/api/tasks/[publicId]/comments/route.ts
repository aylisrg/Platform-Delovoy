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
import { CreateCommentSchema } from "@/modules/tasks/validation";
import { addComment } from "@/modules/tasks/service";

export async function POST(
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

    const parsed = CreateCommentSchema.safeParse(body);
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

    // MANAGER — only on tasks they can see
    if (session.user.role === "MANAGER") {
      const myCats = await prisma.taskCategory.findMany({
        where: { defaultAssigneeUserId: session.user.id },
        select: { id: true },
      });
      const myCatIds = myCats.map((c: { id: string }) => c.id);
      const canSee =
        existing.assigneeUserId === session.user.id ||
        existing.reporterUserId === session.user.id ||
        (existing.type === "ISSUE" &&
          !!existing.categoryId &&
          myCatIds.includes(existing.categoryId));
      if (!canSee) return apiForbidden();
    }

    const comment = await addComment(
      existing.id,
      { body: parsed.data.body, source: "WEB" },
      { id: session.user.id, name: session.user.name ?? null }
    );

    return apiResponse(comment, undefined, 201);
  } catch (err) {
    console.error("[POST /api/tasks/:publicId/comments]", err);
    return apiServerError();
  }
}
