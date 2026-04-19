import { NextRequest } from "next/server";
import { apiResponse, apiValidationError, apiServerError, requireAdminSection } from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { listDeals, createDeal, RentalError } from "@/modules/rental/service";
import { createDealSchema, dealFilterSchema } from "@/modules/rental/validation";
import { apiError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = dealFilterSchema.safeParse(searchParams);
    const filter = parsed.success ? parsed.data : undefined;

    const deals = await listDeals(filter);
    return apiResponse(deals);
  } catch (error) {
    console.error("[Rental] List deals error:", error);
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const body = await request.json();
    const parsed = createDealSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const deal = await createDeal(parsed.data);
    await logAudit(session!.user!.id!, "deal.create", "RentalDeal", deal.id, parsed.data);

    return apiResponse(deal, undefined, 201);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message);
    }
    console.error("[Rental] Create deal error:", error);
    return apiServerError();
  }
}
