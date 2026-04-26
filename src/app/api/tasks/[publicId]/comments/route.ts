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
  createComment,
  listComments,
} from "@/modules/tasks/comments-service";
import { createCommentSchema } from "@/modules/tasks/validation";
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
    const items = await listComments(publicId, {
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });
    return apiResponse(items);
  } catch (err) {
    if (err instanceof TaskNotFoundError) return apiNotFound();
    if (err instanceof TaskAccessError) return apiForbidden();
    return apiServerError();
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const { publicId } = await params;
    const body = await request.json().catch(() => null);
    const parsed = createCommentSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const comment = await createComment(publicId, parsed.data, {
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });
    return apiResponse(comment, undefined, 201);
  } catch (err) {
    if (err instanceof TaskNotFoundError) return apiNotFound();
    if (err instanceof TaskAccessError) return apiForbidden();
    return apiServerError();
  }
}
