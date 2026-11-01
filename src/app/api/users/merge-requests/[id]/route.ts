import { auth } from "@/lib/auth";
import {
  apiError,
  apiForbidden,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { dismissMergeRequest } from "@/modules/clients/merge-requests";
import { DomainError } from "@/modules/clients/merge-errors";
import { mergeRequestActionSchema, mergeRequestIdParamSchema } from "@/modules/clients/merge-validation";

/**
 * PATCH /api/users/merge-requests/[id] `{ action: "dismiss" }` — «Это разные
 * люди» (AC-E4.3): closes the request, the pair is not offered again
 * (AC-E4.4). «Объединить» opens the merge wizard instead — `mergeAccounts`
 * resolves the request itself. SUPERADMIN only; `user.merge_request.dismissed`.
 */

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const id = mergeRequestIdParamSchema.safeParse((await params).id);
  if (!id.success) return apiValidationError("Некорректный идентификатор запроса");

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiValidationError("Некорректный JSON");
  }
  const parsed = mergeRequestActionSchema.safeParse(raw);
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  try {
    return apiResponse(await dismissMergeRequest(id.data, session.user.id));
  } catch (error) {
    if (error instanceof DomainError) {
      return apiError(error.code, error.message, error.status, error.metadata);
    }
    console.error("[users/merge-requests/:id] unexpected error", error);
    return apiServerError();
  }
}
