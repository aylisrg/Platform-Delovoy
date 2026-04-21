import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { taskListQuerySchema } from "@/modules/rental/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = taskListQuerySchema.safeParse(queryParams);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const skip = (parsed.data.page - 1) * parsed.data.limit;

    const where = {
      moduleSlug: "rental",
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.assignedToId ? { assignedToId: parsed.data.assignedToId } : {}),
    };

    const [tasks, total] = await Promise.all([
      prisma.managerTask.findMany({
        where,
        skip,
        take: parsed.data.limit,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      }),
      prisma.managerTask.count({ where }),
    ]);

    const contractIds = [...new Set(tasks.map((t) => t.contractId).filter((v): v is string => !!v))];
    const paymentIds = [...new Set(tasks.map((t) => t.paymentId).filter((v): v is string => !!v))];
    const [contracts, payments] = await Promise.all([
      contractIds.length
        ? prisma.rentalContract.findMany({
            where: { id: { in: contractIds } },
            include: {
              tenant: { select: { id: true, companyName: true, contactName: true, phone: true } },
              office: { select: { id: true, number: true, building: true, floor: true } },
            },
          })
        : Promise.resolve([]),
      paymentIds.length
        ? prisma.rentalPayment.findMany({
            where: { id: { in: paymentIds } },
          })
        : Promise.resolve([]),
    ]);

    const contractMap = new Map(contracts.map((c) => [c.id, c]));
    const paymentMap = new Map(payments.map((p) => [p.id, p]));

    const enriched = tasks.map((t) => ({
      ...t,
      contract: t.contractId ? contractMap.get(t.contractId) ?? null : null,
      payment: t.paymentId ? paymentMap.get(t.paymentId) ?? null : null,
    }));

    return apiResponse(enriched, {
      page: parsed.data.page,
      perPage: parsed.data.limit,
      total,
    });
  } catch {
    return apiServerError();
  }
}
