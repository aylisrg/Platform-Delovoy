import { NextRequest } from "next/server";
import {
  apiResponse,
  apiNotFound,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import {
  getTaskByPublicId,
  softDeleteTask,
  updateTask,
} from "@/modules/tasks/service";
import { updateTaskSchema } from "@/modules/tasks/validation";
import {
  TaskAccessError,
  TaskNotFoundError,
} from "@/modules/tasks/access";

type Params = { params: Promise<{ publicId: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { publicId } = await params;
    const task = await getTaskByPublicId(publicId, {
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });
    return apiResponse(task);
  } catch (err) {
    if (err instanceof TaskNotFoundError) return apiNotFound();
    if (err instanceof TaskAccessError) return apiForbidden();
    return apiServerError();
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { publicId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = updateTaskSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const task = await updateTask(publicId, parsed.data, {
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });
    return apiResponse(task);
  } catch (err) {
    if (err instanceof TaskNotFoundError) return apiNotFound();
    if (err instanceof TaskAccessError) return apiForbidden();
    return apiServerError();
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { publicId } = await params;
    await softDeleteTask(publicId, {
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });
    return apiResponse({ ok: true });
  } catch (err) {
    if (err instanceof TaskNotFoundError) return apiNotFound();
    if (err instanceof TaskAccessError) return apiForbidden();
    return apiServerError();
  }
}
