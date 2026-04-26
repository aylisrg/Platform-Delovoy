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
  createCategory,
  listCategories,
} from "@/modules/tasks/board-service";
import { categorySchema } from "@/modules/tasks/validation";

export async function GET() {
  try {
    const items = await listCategories();
    return apiResponse(items);
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
    const parsed = categorySchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");
    }
    const cat = await createCategory(parsed.data, session.user.id);
    return apiResponse(cat, undefined, 201);
  } catch {
    return apiServerError();
  }
}
