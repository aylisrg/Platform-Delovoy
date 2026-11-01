import { auth } from "@/lib/auth";
import { apiError, apiForbidden, apiResponse, apiServerError, apiUnauthorized, apiValidationError } from "@/lib/api-response";
import { DomainError } from "@/modules/users/errors";
import { getUserOverview } from "@/modules/users/team";
import { userIdParamSchema } from "@/modules/users/validation";

/**
 * GET /api/users/[id]/overview — staff page: profile, identities, bot status,
 * rights review, actions, possible duplicates (US-B1). No password hashes,
 * telegramIds or tokens in the response (AC-B1.8). SUPERADMIN only.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const id = userIdParamSchema.safeParse((await params).id);
  if (!id.success) return apiValidationError("Некорректный идентификатор пользователя");

  try {
    return apiResponse(await getUserOverview(id.data, session.user.id));
  } catch (error) {
    if (error instanceof DomainError) return apiError(error.code, error.message, error.status, error.metadata);
    console.error("[users/overview] error", error);
    return apiServerError();
  }
}
