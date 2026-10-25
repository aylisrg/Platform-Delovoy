import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import {
  apiForbidden,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { rateLimit } from "@/lib/rate-limit";
import { searchMergeCandidates } from "@/modules/clients/merge";
import { mergeSearchQuerySchema } from "@/modules/clients/merge-validation";

/**
 * GET /api/users/merge/search?q=&exclude= — accounts for the merge wizard
 * (AC-E2.1): by name / email / phone / Telegram ID, ≤ 20, non-merged.
 * SUPERADMIN only (AC-E2.11). Fired on debounced keystrokes → per-user limit.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const limited = await rateLimit(request, "authenticated", session.user.id);
  if (limited) return limited;

  const params = request.nextUrl.searchParams;
  const parsed = mergeSearchQuerySchema.safeParse({
    q: params.get("q") ?? "",
    exclude: params.get("exclude") ?? undefined,
  });
  if (!parsed.success) {
    return apiValidationError(parsed.error.issues.map((i) => i.message).join(", "));
  }

  try {
    return apiResponse(await searchMergeCandidates(parsed.data.q, parsed.data.exclude));
  } catch (error) {
    console.error("[users/merge/search] unexpected error", error);
    return apiServerError();
  }
}
