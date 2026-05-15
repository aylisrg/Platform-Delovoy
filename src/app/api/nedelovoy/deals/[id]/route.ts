import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { getDeal, updateDeal, deleteDeal, RentalError } from "@/modules/rental/service";
import { updateDealSchema } from "@/modules/rental/validation";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const { id } = await params;
    const deal = await getDeal(id);
    if (deal.parkSlug !== "nedelovoy") return apiError("NOT_FOUND", "Сделка не найдена", 404);
    return apiResponse(deal);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message, 404);
    }
    return apiServerError();
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const { id } = await params;
    const body = await request.json();
    const parsed = updateDealSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const existing = await getDeal(id);
    if (existing.parkSlug !== "nedelovoy") return apiError("NOT_FOUND", "Сделка не найдена", 404);

    const deal = await updateDeal(id, parsed.data);
    await logAudit(session!.user.id, "deal.update", "RentalDeal", id, parsed.data);

    return apiResponse(deal);
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message, 404);
    }
    return apiServerError();
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "nedelovoy");
    if (denied) return denied;

    const { id } = await params;
    const deal = await getDeal(id);
    if (deal.parkSlug !== "nedelovoy") return apiError("NOT_FOUND", "Сделка не найдена", 404);

    await deleteDeal(id);
    await logAudit(session!.user.id, "deal.delete", "RentalDeal", id);

    return apiResponse({ deleted: true });
  } catch (error) {
    if (error instanceof RentalError) {
      return apiError(error.code, error.message, 404);
    }
    return apiServerError();
  }
}
