import { NextRequest } from "next/server";
import {
  apiForbidden,
  apiNotFound,
  apiResponse,
  apiServerError,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AvitoItemAssignSchema } from "@/lib/avito/validation";
import { itemToDto } from "../_dto";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/avito/items/:id — assign/clear moduleSlug for an Avito item.
 * RBAC: SUPERADMIN only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) return apiUnauthorized();
    if (session.user.role !== "SUPERADMIN") return apiForbidden();

    const { id } = await params;
    const body = await request.json().catch(() => null);
    const parsed = AvitoItemAssignSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error.issues[0]?.message ?? "invalid body");

    const existing = await prisma.avitoItem.findUnique({ where: { id } });
    if (!existing) return apiNotFound("Объявление не найдено");

    const updated = await prisma.avitoItem.update({
      where: { id },
      data: { moduleSlug: parsed.data.moduleSlug },
      include: { statsSnapshots: { take: 1, where: { period: "7d" } } },
    });

    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "avito.item.updateModule",
        entity: "AvitoItem",
        entityId: id,
        metadata: {
          before: existing.moduleSlug ?? null,
          after: parsed.data.moduleSlug,
        },
      },
    });

    return apiResponse({ item: itemToDto(updated, "7d") });
  } catch (err) {
    console.error("[PATCH /api/avito/items/:id] error", err);
    return apiServerError();
  }
}
