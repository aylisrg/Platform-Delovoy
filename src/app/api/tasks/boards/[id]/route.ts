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
import { updateBoard } from "@/modules/tasks/board-service";
import { boardSchema } from "@/modules/tasks/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "ADMIN")) return apiForbidden();
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = boardSchema.partial().safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const board = await updateBoard(id, parsed.data, session.user.id);
    return apiResponse(board);
  } catch {
    return apiServerError();
  }
}
