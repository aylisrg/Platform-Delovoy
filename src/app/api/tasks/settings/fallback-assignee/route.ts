import { NextRequest } from "next/server";
import { z } from "zod";
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
import {
  getGlobalFallbackAssignee,
  setGlobalFallbackAssignee,
} from "@/modules/tasks/routing";
import { logAudit } from "@/lib/logger";

const Body = z.object({ userId: z.string().cuid().nullable() });

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role === "USER") return apiForbidden();

    const userId = await getGlobalFallbackAssignee();
    return apiResponse({ userId });
  } catch (err) {
    console.error("[GET /api/tasks/settings/fallback-assignee]", err);
    return apiServerError();
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") {
      return apiForbidden("Только SUPERADMIN может менять настройки");
    }

    const body = await request.json().catch(() => null);
    if (!body) return apiError("INVALID_JSON", "Неверный JSON", 400);

    const parsed = Body.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0].message);

    if (parsed.data.userId) {
      const user = await prisma.user.findUnique({
        where: { id: parsed.data.userId },
        select: { role: true },
      });
      if (!user) return apiError("INVALID_USER", "Пользователь не найден", 404);
      if (user.role === "USER") {
        return apiError(
          "INVALID_ROLE",
          "Нельзя назначить дежурного роль USER",
          400
        );
      }
    }

    await setGlobalFallbackAssignee(parsed.data.userId);
    await logAudit(
      session.user.id,
      "tasks.fallbackAssignee.set",
      "Module",
      "tasks",
      { userId: parsed.data.userId }
    );

    return apiResponse({ userId: parsed.data.userId });
  } catch (err) {
    console.error("[PATCH /api/tasks/settings/fallback-assignee]", err);
    return apiServerError();
  }
}
