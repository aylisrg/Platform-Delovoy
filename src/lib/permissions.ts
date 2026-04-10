import { Role } from "@prisma/client";
import { prisma } from "./db";

export type SessionUser = {
  id: string;
  role: Role;
  email?: string | null;
  name?: string | null;
};

/**
 * All admin panel sections that can be individually granted/revoked.
 * Each maps to /admin/{section} routes and related API routes.
 */
export const ADMIN_SECTIONS = [
  { slug: "dashboard", label: "Дашборд", icon: "📊" },
  { slug: "gazebos", label: "Беседки", icon: "🏕" },
  { slug: "ps-park", label: "PS Park", icon: "🎮" },
  { slug: "cafe", label: "Кафе", icon: "☕" },
  { slug: "rental", label: "Аренда", icon: "🏢" },
  { slug: "modules", label: "Модули", icon: "📦" },
  { slug: "users", label: "Пользователи", icon: "👥" },
  { slug: "telegram", label: "Telegram", icon: "📨" },
  { slug: "monitoring", label: "Мониторинг", icon: "🔍" },
  { slug: "architect", label: "Архитектор", icon: "🗺" },
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number]["slug"];

export const ADMIN_SECTION_SLUGS: AdminSection[] = ADMIN_SECTIONS.map((s) => s.slug);

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

/**
 * Check if user has access to a specific admin panel section.
 * SUPERADMIN always has access to everything.
 * MANAGER needs explicit AdminPermission records.
 */
export async function hasAdminSectionAccess(
  userId: string,
  section: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user) return false;
  if (user.role === "SUPERADMIN") return true;
  if (user.role === "USER") return false;

  // MANAGER — check explicit permission
  const permission = await prisma.adminPermission.findUnique({
    where: { userId_section: { userId, section } },
  });

  return !!permission;
}

/**
 * Get all admin sections a user has access to.
 * SUPERADMIN gets all sections. MANAGER gets only granted ones.
 */
export async function getUserAdminSections(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (!user) return [];
  if (user.role === "USER") return [];

  if (user.role === "SUPERADMIN") {
    return ADMIN_SECTION_SLUGS;
  }

  const permissions = await prisma.adminPermission.findMany({
    where: { userId },
    select: { section: true },
  });

  return permissions.map((p) => p.section);
}

/**
 * Set admin section permissions for a user. Replaces all existing permissions.
 * Only SUPERADMIN should call this.
 */
export async function setUserAdminSections(
  userId: string,
  sections: string[]
): Promise<void> {
  // Validate sections
  const validSections = sections.filter((s) =>
    ADMIN_SECTION_SLUGS.includes(s as AdminSection)
  );

  await prisma.$transaction([
    // Delete all existing permissions for this user
    prisma.adminPermission.deleteMany({ where: { userId } }),
    // Create new permissions
    ...(validSections.length > 0
      ? [
          prisma.adminPermission.createMany({
            data: validSections.map((section) => ({ userId, section })),
          }),
        ]
      : []),
  ]);
}

/**
 * Extract the admin section slug from a pathname.
 * e.g. "/admin/cafe" -> "cafe", "/admin/architect/logs" -> "architect"
 */
export function extractAdminSection(pathname: string): string | null {
  const match = pathname.match(/^\/admin\/([^/]+)/);
  return match ? match[1] : null;
}
