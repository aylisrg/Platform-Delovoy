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
import { addColumn } from "@/modules/tasks/board-service";
import { columnSchema } from "@/modules/tasks/validation";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "ADMIN")) return apiForbidden();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = columnSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const column = await addColumn(id, parsed.data, session.user.id);
    return apiResponse(column, undefined, 201);
  } catch {
    return apiServerError();
  }
}
