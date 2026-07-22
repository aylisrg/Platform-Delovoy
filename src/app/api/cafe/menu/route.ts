import { NextRequest } from "next/server";
import {
  apiResponse,
  apiUnauthorized,
  apiValidationError,
  apiServerError,
  requireAdminSection,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { createMenuItem, getMenuAdmin } from "@/modules/cafe/service";
import { createMenuItemSchema } from "@/modules/cafe/validation";

/**
 * GET /api/cafe/menu — полное меню для админ-каталога (включая скрытые позиции)
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "cafe");
    if (denied) return denied;

    const items = await getMenuAdmin();
    return apiResponse(items);
  } catch {
    return apiServerError();
  }
}

/**
 * POST /api/cafe/menu — создать позицию меню (персонал секции cafe)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    const denied = await requireAdminSection(session, "cafe");
    if (denied) return denied;

    const body = await request.json();
    const parsed = createMenuItemSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error.issues[0].message);
    }

    const item = await createMenuItem(parsed.data);

    await logAudit(session.user.id, "menu_item.create", "MenuItem", item.id, {
      name: item.name,
      category: item.category,
      price: Number(item.price),
    });

    return apiResponse(item, undefined, 201);
  } catch {
    return apiServerError();
  }
}
