import { auth } from "@/lib/auth";
import { apiForbidden, apiResponse, apiServerError, apiUnauthorized, apiValidationError } from "@/lib/api-response";
import { getTeamOverview } from "@/modules/users/team";
import { teamOverviewQuerySchema } from "@/modules/users/validation";

/**
 * GET /api/users/team — the «Команда» review screen: rights, channels, bot
 * status and subscriptions of every staff member (US-B2).
 * SUPERADMIN only (ADR 2026-10-25-team-access-notifications §6.1).
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = teamOverviewQuerySchema.safeParse(params);
  if (!parsed.success) return apiValidationError(parsed.error.issues[0]?.message ?? "Некорректный запрос");

  try {
    const { rows, pendingMergeRequests } = await getTeamOverview(parsed.data);
    return apiResponse({ rows, pendingMergeRequests }, { total: rows.length });
  } catch (error) {
    console.error("[users/team] error", error);
    return apiServerError();
  }
}
