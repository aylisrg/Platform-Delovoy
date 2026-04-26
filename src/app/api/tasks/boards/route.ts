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
import { createBoard, listBoards } from "@/modules/tasks/board-service";
import { boardSchema } from "@/modules/tasks/validation";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const boards = await listBoards();
    return apiResponse(boards);
  } catch {
    return apiServerError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "ADMIN")) return apiForbidden();
    const body = await request.json().catch(() => null);
    const parsed = boardSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const board = await createBoard(parsed.data, session.user.id);
    return apiResponse(board, undefined, 201);
  } catch {
    return apiServerError();
  }
}
