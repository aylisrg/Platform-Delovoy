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
import { CreateTaskSchema, ListTasksSchema } from "@/modules/tasks/validation";
import { createTask, listTasks, type TaskVisibilityScope } from "@/modules/tasks/service";

async function buildScope(session: {
  user: { id: string; role: string };
}): Promise<TaskVisibilityScope> {
  const { role, id } = session.user;
  if (role === "SUPERADMIN" || role === "ADMIN") {
    return { role: role as "SUPERADMIN" | "ADMIN" };
  }
  if (role === "MANAGER") {
    const cats = await prisma.taskCategory.findMany({
      where: { defaultAssigneeUserId: id },
      select: { id: true },
    });
    return {
      role: "MANAGER",
      userId: id,
      categoryIds: cats.map((c: { id: string }) => c.id),
    };
  }
  return { role: "USER" };
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role === "USER") return apiForbidden();

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = ListTasksSchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const scope = await buildScope(session);
    const { items, total } = await listTasks(parsed.data, scope);

    return apiResponse(items, {
      page: parsed.data.page,
      perPage: parsed.data.pageSize,
      total,
    });
  } catch (err) {
    console.error("[GET /api/tasks]", err);
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role === "USER") return apiForbidden();

    const body = await request.json().catch(() => null);
    if (!body) return apiError("INVALID_JSON", "Неверный JSON", 400);

    const parsed = CreateTaskSchema.safeParse({
      ...body,
      reporterUserId: body.reporterUserId ?? session.user.id,
    });
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const task = await createTask(parsed.data, {
      id: session.user.id,
      source: "user",
    });

    return apiResponse(task, undefined, 201);
  } catch (err) {
    console.error("[POST /api/tasks]", err);
    return apiServerError();
  }
}
