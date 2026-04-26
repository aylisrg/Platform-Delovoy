import { NextRequest } from "next/server";
import {
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import {
  archiveCategory,
  updateCategory,
} from "@/modules/tasks/board-service";
import { categorySchema } from "@/modules/tasks/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "ADMIN")) return apiForbidden();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = categorySchema.partial().safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const cat = await updateCategory(id, parsed.data, session.user.id);
    return apiResponse(cat);
  } catch {
    return apiServerError();
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "ADMIN")) return apiForbidden();
    const { id } = await params;
    await archiveCategory(id, session.user.id);
    return apiResponse({ ok: true });
  } catch {
    return apiServerError();
  }
}
