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
import { updateTaskSchema } from "@/modules/rental/validation";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const userId = session!.user.id;
    const { id } = await params;
    const body = await request.json();
    const parsed = updateTaskSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const task = await prisma.managerTask.findUnique({ where: { id } });
    if (!task) return apiNotFound("Задача не найдена");
    if (task.status !== "OPEN" && task.status !== "DEFERRED") {
      return apiResponse(task); // already resolved
    }

    const markPaid =
      parsed.data.status === "RESOLVED" &&
      parsed.data.markPaymentPaid &&
      !!task.paymentId;

    // Atomic: task resolution + payment mark-paid must succeed together (AC-5.5).
    const [updated] = await prisma.$transaction([
      prisma.managerTask.update({
        where: { id },
        data: {
          status: parsed.data.status,
          resolvedAt: parsed.data.status === "RESOLVED" ? new Date() : null,
          resolvedById: parsed.data.status === "RESOLVED" ? userId : null,
          resolution: parsed.data.resolution ?? null,
          resolutionNote: parsed.data.resolutionNote ?? null,
          deferUntil:
            parsed.data.status === "DEFERRED" && parsed.data.deferUntil
              ? new Date(parsed.data.deferUntil)
              : null,
        },
      }),
      ...(markPaid && task.paymentId
        ? [
            prisma.rentalPayment.update({
              where: { id: task.paymentId },
              data: { paidAt: new Date(), markedPaidById: userId },
            }),
          ]
        : []),
    ]);

    await logAudit(userId, "manager_task.resolved", "ManagerTask", updated.id, {
      status: updated.status,
      resolution: updated.resolution,
      markPaymentPaid: parsed.data.markPaymentPaid,
    });

    return apiResponse(updated);
  } catch {
    return apiServerError();
  }
}
