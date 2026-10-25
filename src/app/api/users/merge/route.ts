import { auth } from "@/lib/auth";
import {
  apiError,
  apiForbidden,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { mergeAccounts } from "@/modules/clients/merge";
import { DomainError } from "@/modules/clients/merge-errors";
import { SAME_ACCOUNT_MESSAGE, mergeExecuteSchema } from "@/modules/clients/merge-validation";

/**
 * POST /api/users/merge — merge two accounts (PRD US-E2, ADR §Q6/§6.2).
 * Requires `confirmIrreversible: true` (AC-E2.5) and, for different
 * Telegrams, `confirmTelegramConflict: true` (AC-E2.4г). SUPERADMIN only;
 * audited as `auth.merge.manual` inside the merge transaction.
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

  const parsed = mergeExecuteSchema.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.message === SAME_ACCOUNT_MESSAGE)) {
      return apiError("SAME_ACCOUNT", SAME_ACCOUNT_MESSAGE, 422);
    }
    return apiValidationError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  try {
    const result = await mergeAccounts({
      primaryId: parsed.data.primaryId,
      secondaryId: parsed.data.secondaryId,
      actorId: session.user.id,
      mode: "admin",
      confirmTelegramConflict: parsed.data.confirmTelegramConflict,
    });
    return apiResponse({
      primaryId: result.primaryId,
      tombstonedUserId: result.tombstonedUserId,
      resultingRole: result.resultingRole,
      moved: result.moved,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return apiError(error.code, error.message, error.status, error.metadata);
    }
    console.error("[users/merge] unexpected error", error);
    return apiServerError();
  }
}
