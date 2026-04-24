import { NextRequest } from "next/server";
import {
  apiResponse,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CreateCategorySchema } from "@/modules/tasks/validation";
import { logAudit } from "@/lib/logger";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role === "USER") return apiForbidden();

    const categories = await prisma.taskCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        defaultAssignee: { select: { id: true, name: true, email: true } },
      },
    });

    return apiResponse(categories);
  } catch (err) {
    console.error("[GET /api/tasks/categories]", err);
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") {
      return apiForbidden("Только SUPERADMIN может управлять категориями");
    }

    const body = await request.json().catch(() => null);
    if (!body) return apiError("INVALID_JSON", "Неверный JSON", 400);

    const parsed = CreateCategorySchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    const created = await prisma.taskCategory.create({
      data: parsed.data,
    });

    await logAudit(session.user.id, "task.category.create", "TaskCategory", created.id, {
      slug: created.slug,
    });

    return apiResponse(created, undefined, 201);
  } catch (err) {
    console.error("[POST /api/tasks/categories]", err);
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return apiError("DUPLICATE_SLUG", "Категория с таким slug уже существует", 409);
    }
    return apiServerError();
  }
}
