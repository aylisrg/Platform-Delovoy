import { NextRequest } from "next/server";
import {
  apiResponse,
  apiNotFound,
  apiForbidden,
  apiServerError,
  apiUnauthorized,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { removeAssignee } from "@/modules/tasks/assignees-service";
import {
  TaskAccessError,
  TaskNotFoundError,
} from "@/modules/tasks/access";

type Params = { params: Promise<{ publicId: string; userId: string }> };

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { publicId, userId } = await params;
    await removeAssignee(publicId, userId, {
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
