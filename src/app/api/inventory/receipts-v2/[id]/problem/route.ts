import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiServerError,
  apiNotFound,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { canFlagProblem } from "@/lib/permissions";
import { flagProblem, getReceipt, InventoryError } from "@/modules/inventory/service-v2";
import { flagProblemSchema } from "@/modules/inventory/validation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const { role } = session.user;
    if (role !== "SUPERADMIN" && role !== "ADMIN" && role !== "MANAGER") return apiForbidden();

    const { id } = await params;

    const body = await request.json();
    const parsed = flagProblemSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const receipt = await getReceipt(id).catch(() => null);
    if (!receipt) return apiNotFound("Приход не найден");

    const allowed = await canFlagProblem(
      { id: session.user.id, role },
      receipt.moduleSlug ?? "cafe",
      receipt.performedById
    );
    if (!allowed) return apiForbidden();

    const result = await flagProblem(id, parsed.data.problemNote, session.user.id);

    await logAudit(session.user.id, "inventory.receipt.problem", "StockReceipt", id, {
      problemNote: parsed.data.problemNote,
    });

    return apiResponse(result);
  } catch (error) {
    if (error instanceof InventoryError) {
      if (error.code === "RECEIPT_NOT_FOUND") return apiNotFound(error.message);
      return apiError(error.code, error.message);
    }
    return apiServerError();
  }
}
