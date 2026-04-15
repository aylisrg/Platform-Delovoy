import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { addComment, NotFoundError } from "@/modules/feedback/service";
import { createCommentSchema } from "@/modules/feedback/validation";

/**
 * POST /api/feedback/[id]/comments — add admin comment (SUPERADMIN only)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = createCommentSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message || "Некорректные данные");
    }

    const comment = await addComment(id, session.user.id, parsed.data.text);
    return apiResponse(comment, undefined, 201);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return apiResponse(null, undefined, 404);
    }
    return apiServerError();
  }
}
