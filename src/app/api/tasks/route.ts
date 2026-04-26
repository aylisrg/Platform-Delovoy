import { NextRequest } from "next/server";
import {
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { createTask, listTasks } from "@/modules/tasks/service";
import {
  createTaskSchema,
  taskListQuerySchema,
} from "@/modules/tasks/validation";
import { TaskAccessError } from "@/modules/tasks/access";
import { hasRole } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    // Coerce array params from comma-sep
    const arrayParams = ["priority", "labels"];
    for (const k of arrayParams) {
      if (typeof params[k] === "string") {
        (params as Record<string, unknown>)[k] = params[k].split(",").filter(Boolean);
      }
    }
    const parsed = taskListQuerySchema.safeParse(params);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid query");
    }
    const result = await listTasks(
      { actorUserId: session.user.id, actorRole: session.user.role },
      parsed.data
    );
    return apiResponse(result.items, {
      page: result.page,
      perPage: result.perPage,
      total: result.total,
    });
  } catch {
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiValidationError("forbidden");
    }
    const body = await request.json().catch(() => null);
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const task = await createTask({
      data: parsed.data,
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });
    return apiResponse(task, undefined, 201);
  } catch (err) {
    if (err instanceof TaskAccessError) return apiUnauthorized();
    return apiServerError();
  }
}
