import { NextRequest } from "next/server";
import {
  apiResponse,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { emailLogQuerySchema } from "@/modules/rental/validation";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const denied = await requireAdminSection(session, "rental");
    if (denied) return denied;

    const queryParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = emailLogQuerySchema.safeParse(queryParams);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const { page, limit } = parsed.data;
    const skip = (page - 1) * limit;

    const where = {
      moduleSlug: "rental",
      ...(parsed.data.tenantId ? { tenantId: parsed.data.tenantId } : {}),
      ...(parsed.data.contractId ? { contractId: parsed.data.contractId } : {}),
      ...(parsed.data.type ? { type: parsed.data.type } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.from || parsed.data.to
        ? {
            sentAt: {
              ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
              ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {}),
            },
          }
        : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.emailLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { sentAt: "desc" },
      }),
      prisma.emailLog.count({ where }),
    ]);

    return apiResponse(logs, { page, perPage: limit, total });
  } catch {
    return apiServerError();
  }
}
