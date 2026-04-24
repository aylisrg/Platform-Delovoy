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
import { SubscribeSchema } from "@/modules/tasks/validation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ publicId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role === "USER") return apiForbidden();

    const { publicId } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = SubscribeSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const task = await prisma.task.findUnique({
      where: { publicId },
      select: { id: true },
    });
    if (!task) return apiNotFound("Задача не найдена");

    const sub = await prisma.taskSubscription.upsert({
      where: { taskId_userId: { taskId: task.id, userId: session.user.id } },
      create: { taskId: task.id, userId: session.user.id, channels: parsed.data.channels },
      update: { channels: parsed.data.channels },
    });

    return apiResponse(sub, undefined, 201);
  } catch (err) {
    console.error("[POST /api/tasks/:publicId/subscribe]", err);
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
      select: { id: true },
    });
    if (!task) return apiNotFound("Задача не найдена");

    await prisma.taskSubscription.deleteMany({
      where: { taskId: task.id, userId: session.user.id },
    });

    return apiResponse({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/tasks/:publicId/subscribe]", err);
    return apiServerError();
  }
}
