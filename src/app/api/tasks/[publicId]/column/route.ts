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
import { moveTaskToColumn } from "@/modules/tasks/service";
import { moveTaskColumnSchema } from "@/modules/tasks/validation";
import {
  TaskAccessError,
  TaskNotFoundError,
  TaskValidationError,
} from "@/modules/tasks/access";

type Params = { params: Promise<{ publicId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { publicId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = moveTaskColumnSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const task = await moveTaskToColumn(publicId, parsed.data, {
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });
    return apiResponse({
      publicId: task.publicId,
      columnId: task.columnId,
      sortOrder: task.sortOrder,
      closedAt: task.closedAt,
    });
  } catch (err) {
    if (err instanceof TaskNotFoundError) return apiNotFound();
    if (err instanceof TaskAccessError) return apiForbidden();
    if (err instanceof TaskValidationError)
      return apiValidationError(err.message);
    return apiServerError();
  }
}
