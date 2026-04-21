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
import { paymentsListQuerySchema } from "@/modules/rental/validation";
import { listPaymentsForContract } from "@/modules/rental/payments";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const { id } = await params;
    const contract = await prisma.rentalContract.findUnique({ where: { id } });
    if (!contract) return apiNotFound("Договор не найден");

    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = paymentsListQuerySchema.safeParse(queryParams);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const payments = await listPaymentsForContract(id, parsed.data);
    return apiResponse(payments);
  } catch {
    return apiServerError();
  }
}
