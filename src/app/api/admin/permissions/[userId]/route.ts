import { auth } from "@/lib/auth";
import {
  apiResponse,
  apiError,
  apiForbidden,
  apiUnauthorized,
  apiValidationError,
} from "@/lib/api-response";
import {
  getUserAdminSections,
  setUserAdminSections,
  ADMIN_SECTIONS,
  ADMIN_SECTION_SLUGS,
} from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { z } from "zod";

const updatePermissionsSchema = z.object({
  sections: z.array(z.string()),
});

/**
 * GET /api/admin/permissions/[userId]
 * Returns admin sections the user has access to, plus the full list for reference.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { userId } = await params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, role: true },
  });

  if (!user) {
    return apiError("NOT_FOUND", "Пользователь не найден", 404);
  }

  const grantedSections = await getUserAdminSections(userId);

  return apiResponse({
    userId: user.id,
    userName: user.name,
    userRole: user.role,
    grantedSections,
    allSections: ADMIN_SECTIONS,
  });
}

/**
 * PUT /api/admin/permissions/[userId]
 * Set admin section permissions for a user. Replaces all existing ones.
 * Body: { sections: ["dashboard", "cafe", ...] }
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN") return apiForbidden();

  const { userId } = await params;

  // Cannot change own permissions (superadmin always has full access)
  if (userId === session.user.id) {
    return apiError(
      "CANNOT_EDIT_OWN",
      "Суперадмин всегда имеет полный доступ",
      400
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) {
    return apiError("NOT_FOUND", "Пользователь не найден", 404);
  }

  if (user.role !== "MANAGER") {
    return apiError(
      "INVALID_ROLE",
      "Права доступа можно настроить только для менеджеров",
      400
    );
  }

  try {
    const body = await request.json();
    const parsed = updatePermissionsSchema.safeParse(body);

    if (!parsed.success) {
      return apiValidationError(
        parsed.error.issues.map((i) => i.message).join(", ")
      );
    }

    // Filter to only valid section slugs
    const validSections = parsed.data.sections.filter((s) =>
      (ADMIN_SECTION_SLUGS as readonly string[]).includes(s)
    );

    await setUserAdminSections(userId, validSections);

    // Log the action
    await prisma.auditLog.create({
      data: {
        userId: session.user.id,
        action: "permissions.update",
        entity: "AdminPermission",
        entityId: userId,
        metadata: { sections: validSections },
      },
    });

    return apiResponse({
      userId,
      grantedSections: validSections,
    });
  } catch {
    return apiError("INTERNAL_ERROR", "Ошибка обновления прав доступа", 500);
  }
}
