import { NextRequest } from "next/server";
import { apiResponse, apiValidationError, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { reorderDeals } from "@/modules/rental/service";
import { reorderDealsSchema } from "@/modules/rental/validation";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const body = await request.json();
    const parsed = reorderDealsSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    await reorderDeals(parsed.data.updates);
    return apiResponse({ reordered: true });
  } catch (error) {
    console.error("[Rental] Reorder deals error:", error);
    return apiServerError();
  }
}
