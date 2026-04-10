import { auth } from "@/lib/auth";
import { apiResponse, apiForbidden, apiUnauthorized } from "@/lib/api-response";
import { getUserAdminSections } from "@/lib/permissions";

/**
 * GET /api/admin/permissions/me
 * Returns the current user's admin section permissions.
 * Used by the sidebar to render only accessible navigation items.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return apiUnauthorized();
  if (session.user.role !== "SUPERADMIN" && session.user.role !== "MANAGER") {
    return apiForbidden();
  }

  const sections = await getUserAdminSections(session.user.id);

  return apiResponse({
    role: session.user.role,
    sections,
  });
}
