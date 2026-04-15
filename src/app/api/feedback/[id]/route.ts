import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiNotFound,
  apiForbidden,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { getFeedbackById, updateFeedbackStatus, NotFoundError } from "@/modules/feedback/service";
import { updateFeedbackStatusSchema } from "@/modules/feedback/validation";

/**
 * GET /api/feedback/[id] — get feedback detail with comments
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const { id } = await params;
    const feedback = await getFeedbackById(id, session.user.id, session.user.role);
    if (!feedback) return apiNotFound("Обращение не найдено");

    // Map screenshotPath to URL for response
    const data = {
      ...feedback,
      screenshotUrl: feedback.screenshotPath
        ? `/api/feedback/uploads/${feedback.screenshotPath}`
        : null,
    };

    return apiResponse(data);
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/feedback/[id] — update feedback status (SUPERADMIN only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const { id } = await params;
    const body = await request.json();
    const parsed = updateFeedbackStatusSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message || "Некорректный статус");
    }

    const result = await updateFeedbackStatus(id, parsed.data.status, session.user.id);
    return apiResponse(result);
  } catch (error) {
    if (error instanceof NotFoundError) return apiNotFound(error.message);
    return apiServerError();
  }
}
