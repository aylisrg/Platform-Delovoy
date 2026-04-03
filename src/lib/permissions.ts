import { Role } from "@prisma/client";
import { prisma } from "./db";

export type SessionUser = {
  id: string;
  role: Role;
  email?: string | null;
  name?: string | null;
};

/**
 * Check if user has the required role or higher.
 * Hierarchy: SUPERADMIN > MANAGER > USER
 */
export function hasRole(user: SessionUser, requiredRole: Role): boolean {
  const hierarchy: Record<Role, number> = {
    USER: 0,
    MANAGER: 1,
    SUPERADMIN: 2,
  };
  return hierarchy[user.role] >= hierarchy[requiredRole];
}

/**
 * Check if user has access to a specific module.
 * SUPERADMIN has access to all modules.
 */
export async function hasModuleAccess(
  userId: string,
  moduleSlug: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user) return false;
  if (user.role === "SUPERADMIN") return true;

  const assignment = await prisma.moduleAssignment.findFirst({
    where: {
      userId,
      module: { slug: moduleSlug, isActive: true },
    },
  });

  return !!assignment;
}

/**
 * Get all module slugs a user has access to.
 */
export async function getUserModules(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user) return [];

  if (user.role === "SUPERADMIN") {
    const modules = await prisma.module.findMany({
      where: { isActive: true },
      select: { slug: true },
    });
    return modules.map((m) => m.slug);
  }

  const assignments = await prisma.moduleAssignment.findMany({
    where: { userId },
    include: { module: { select: { slug: true, isActive: true } } },
  });

  return assignments
    .filter((a) => a.module.isActive)
    .map((a) => a.module.slug);
}
