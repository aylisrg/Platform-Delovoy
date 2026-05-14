import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { reorderDeals } from "@/modules/rental/service";
import { reorderDealsSchema } from "@/modules/rental/validation";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const body = await request.json();
    const parsed = reorderDealsSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const ids = parsed.data.updates.map((u) => u.dealId);
    const deals = await prisma.rentalDeal.findMany({
      where: { id: { in: ids } },
      select: { id: true, parkSlug: true },
    });
    const wrongPark = deals.some((d) => d.parkSlug !== "nedelovoy");
    if (wrongPark || deals.length !== ids.length) {
      return apiError("NOT_FOUND", "Одна или несколько сделок не найдены");
    }

    await reorderDeals(parsed.data.updates);
    return apiResponse({ reordered: true });
  } catch (error) {
    console.error("[Nedelovoy] Reorder deals error:", error);
    return apiServerError();
  }
}
