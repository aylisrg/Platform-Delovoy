import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  apiNotFound,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/logger";
import { updatePaymentSchema } from "@/modules/rental/validation";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const { id } = await params;
    const body = await request.json();
    const parsed = updatePaymentSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const existing = await prisma.rentalPayment.findUnique({ where: { id } });
    if (!existing) return apiNotFound("Платёж не найден");

    const userId = session!.user.id;
    const updated = await prisma.rentalPayment.update({
      where: { id },
      data: {
        ...(parsed.data.paidAt !== undefined && {
          paidAt: parsed.data.paidAt ? new Date(parsed.data.paidAt) : null,
          markedPaidById: parsed.data.paidAt ? userId : null,
        }),
        ...(parsed.data.amount !== undefined && { amount: parsed.data.amount }),
        ...(parsed.data.amountAdjustmentReason !== undefined && {
          amountAdjustmentReason: parsed.data.amountAdjustmentReason,
        }),
      },
    });

    await logAudit(userId, "rental_payment.updated", "RentalPayment", updated.id, {
      before: {
        paidAt: existing.paidAt,
        amount: existing.amount.toString(),
      },
      after: {
        paidAt: updated.paidAt,
        amount: updated.amount.toString(),
      },
      reason: parsed.data.amountAdjustmentReason,
    });

    return apiResponse(updated);
  } catch {
    return apiServerError();
  }
}
