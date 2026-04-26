import { NextRequest } from "next/server";
import {
  apiResponse,
  apiNotFound,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
  apiError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { addAssignee } from "@/modules/tasks/assignees-service";
import { addAssigneeSchema } from "@/modules/tasks/validation";
import {
  TaskAccessError,
  TaskNotFoundError,
  TaskValidationError,
} from "@/modules/tasks/access";

type Params = { params: Promise<{ publicId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { publicId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = addAssigneeSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const assignee = await addAssignee(publicId, parsed.data, {
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });
    return apiResponse(assignee, undefined, 201);
  } catch (err) {
    if (err instanceof TaskNotFoundError) return apiNotFound();
    if (err instanceof TaskAccessError) return apiForbidden();
    if (err instanceof TaskValidationError) return apiError(err.code, err.message, 409);
    return apiServerError();
  }
}
