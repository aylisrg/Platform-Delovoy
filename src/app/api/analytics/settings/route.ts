import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { apiResponse, apiError, requireAdminSection, apiServerError } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";
import { setPrimaryGoalId } from "@/modules/analytics/service";

/**
 * GET /api/analytics/settings — return analytics module settings.
 */
export async function GET() {
  const session = await auth();
  const denied = await requireAdminSection(session, "analytics");
  if (denied) return denied;

  try {
    const mod = await prisma.module.findUnique({
      where: { slug: "analytics" },
      select: { config: true },
    });
    const config = (mod?.config as Record<string, unknown>) ?? {};
    return apiResponse({
      primaryGoalId: typeof config.primaryGoalId === "number" ? config.primaryGoalId : null,
    });
  } catch (error) {
    console.error("[Analytics Settings] GET error:", error);
    return apiServerError();
  }
}

/**
 * PATCH /api/analytics/settings — update analytics module settings.
 * Body: { primaryGoalId: number | null }
 */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  const denied = await requireAdminSection(session, "analytics");
  if (denied) return denied;

  try {
    const body = await request.json();
    const { primaryGoalId } = body;

    if (primaryGoalId !== null && typeof primaryGoalId !== "number") {
      return apiError("VALIDATION_ERROR", "primaryGoalId must be a number or null", 422);
    }

    await setPrimaryGoalId(primaryGoalId);

    await logAudit(
      session!.user!.id!,
      "analytics.settings.update",
      "Module",
      "analytics",
      { primaryGoalId }
    );

    return apiResponse({ primaryGoalId });
  } catch (error) {
    console.error("[Analytics Settings] PATCH error:", error);
    return apiServerError();
  }
}
