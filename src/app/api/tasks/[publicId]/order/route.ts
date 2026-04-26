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
import { reorderTaskInColumn } from "@/modules/tasks/service";
import { reorderTaskSchema } from "@/modules/tasks/validation";
import {
  TaskAccessError,
  TaskNotFoundError,
} from "@/modules/tasks/access";

type Params = { params: Promise<{ publicId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { publicId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = reorderTaskSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const task = await reorderTaskInColumn(publicId, parsed.data.sortOrder, {
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });
    return apiResponse({ publicId: task.publicId, sortOrder: task.sortOrder });
  } catch (err) {
    if (err instanceof TaskNotFoundError) return apiNotFound();
    if (err instanceof TaskAccessError) return apiForbidden();
    return apiServerError();
  }
}
