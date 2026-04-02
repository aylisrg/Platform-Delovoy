import { NextRequest } from "next/server";
import {
  apiResponse,
  apiNotFound,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/permissions";
import { logAudit } from "@/lib/logger";
import { getMenuItem, createMenuItem, updateMenuItem } from "@/modules/cafe/service";
import { updateMenuItemSchema } from "@/modules/cafe/validation";

/**
 * GET /api/cafe/menu/:id — get single menu item
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const item = await getMenuItem(id);
    if (!item) return apiNotFound("Позиция меню не найдена");
    return apiResponse(item);
  } catch {
    return apiServerError();
  }
}

/**
 * PATCH /api/cafe/menu/:id — update menu item (manager only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (!hasRole(session.user, "MANAGER")) {
      return apiUnauthorized("Недостаточно прав");
    }

    const { id } = await params;
    const body = await request.json();
    const parsed = updateMenuItemSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const updated = await updateMenuItem(id, parsed.data);

    await logAudit(session.user.id, "menu_item.update", "MenuItem", id, parsed.data);

    return apiResponse(updated);
  } catch {
    return apiServerError();
  }
}
