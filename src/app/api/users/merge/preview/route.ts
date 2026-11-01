import { auth } from "@/lib/auth";
import {
  apiError,
  apiForbidden,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { previewAccountMerge } from "@/modules/clients/merge";
import { DomainError } from "@/modules/clients/merge-errors";
import { SAME_ACCOUNT_MESSAGE, mergePairSchema } from "@/modules/clients/merge-validation";

/**
 * POST /api/users/merge/preview — «Превью» of an account merge (AC-E2.3).
 * Reads only, changes nothing. SUPERADMIN only (AC-E2.11).
 * ADR 2026-10-25-team-access-notifications §6.2.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiValidationError("Некорректный JSON");
  }

  const parsed = mergePairSchema.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.message === SAME_ACCOUNT_MESSAGE)) {
      return apiError("SAME_ACCOUNT", SAME_ACCOUNT_MESSAGE, 422);
    }
    return apiValidationError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  try {
    const preview = await previewAccountMerge({
      primaryId: parsed.data.primaryId,
      secondaryId: parsed.data.secondaryId,
      actorId: session.user.id,
      mode: "admin",
    });
    return apiResponse(preview);
  } catch (error) {
    if (error instanceof DomainError) {
      return apiError(error.code, error.message, error.status, error.metadata);
    }
    console.error("[users/merge/preview] unexpected error", error);
    return apiServerError();
  }
}
