import { NextRequest } from "next/server";
import {
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import {
  deleteColumn,
  updateColumn,
} from "@/modules/tasks/board-service";
import { columnSchema } from "@/modules/tasks/validation";
import { TaskValidationError } from "@/modules/tasks/access";

type Params = { params: Promise<{ id: string; columnId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "ADMIN")) return apiForbidden();
    const { columnId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = columnSchema.partial().safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const column = await updateColumn(columnId, parsed.data, session.user.id);
    return apiResponse(column);
  } catch {
    return apiServerError();
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "ADMIN")) return apiForbidden();
    const { columnId } = await params;
    await deleteColumn(columnId, session.user.id);
    return apiResponse({ ok: true });
  } catch (err) {
    if (err instanceof TaskValidationError) return apiError(err.code, err.message, 409);
    return apiServerError();
  }
}
