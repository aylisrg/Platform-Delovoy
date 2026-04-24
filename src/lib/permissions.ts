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
  { slug: "gazebos", label: "Барбекю Парк", icon: "🏕" },
  { slug: "ps-park", label: "Плей Парк", icon: "🎮" },
  { slug: "cafe", label: "Кафе", icon: "☕" },
  { slug: "rental", label: "Аренда", icon: "🏢" },
  { slug: "modules", label: "Модули", icon: "📦" },
  { slug: "users", label: "Пользователи", icon: "👥" },
  { slug: "inventory", label: "Склад", icon: "📋" },
  { slug: "analytics", label: "Аналитика", icon: "📈" },
  { slug: "management", label: "Управленка", icon: "💰" },
  { slug: "monitoring", label: "Мониторинг", icon: "🔍" },
  { slug: "architect", label: "Архитектор", icon: "🗺" },
  { slug: "tasks", label: "Задачи", icon: "✅" },
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number]["slug"];

export const ADMIN_SECTION_SLUGS: AdminSection[] = ADMIN_SECTIONS.map((s) => s.slug);

/**
 * Modules where ADMIN role has unrestricted edit access by role alone —
 * no AdminPermission or ModuleAssignment record required.
 * Per product decision: admin fully owns Барбекю Парк, Плей Парк и Склад.
 * SUPERADMIN always has access to everything (including these).
 * Deletion in these modules is still SUPERADMIN-only.
 */
export const ADMIN_EDITABLE_MODULES = [
  "gazebos",
  "ps-park",
  "inventory",
] as const;

export type AdminEditableModule = (typeof ADMIN_EDITABLE_MODULES)[number];

export function isAdminEditableModule(slug: string): slug is AdminEditableModule {
  return (ADMIN_EDITABLE_MODULES as readonly string[]).includes(slug);
}

/**
 * Check if user has the required role or higher.
 * Hierarchy: SUPERADMIN (3) > ADMIN (2) > MANAGER (1) > USER (0)
 */
export function hasRole(user: SessionUser, requiredRole: Role): boolean {
  const hierarchy: Record<Role, number> = {
    USER: 0,
    MANAGER: 1,
    ADMIN: 2,
    SUPERADMIN: 3,
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
 * ADMIN and MANAGER need explicit AdminPermission records.
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

  // ADMIN and MANAGER — check explicit permission
  const permission = await prisma.adminPermission.findUnique({
    where: { userId_section: { userId, section } },
  });

  return !!permission;
}

/**
 * Get all admin sections a user has access to.
 * SUPERADMIN gets all sections. ADMIN and MANAGER get only granted ones.
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
 * Check if user can edit (create/update) resources in the given module.
 *
 * Policy:
 * - SUPERADMIN: yes, for any module.
 * - ADMIN: yes for ADMIN_EDITABLE_MODULES (gazebos, ps-park, inventory) by role.
 *          For other modules — requires AdminPermission for the section.
 * - MANAGER: requires AdminPermission for the section.
 * - USER: no.
 *
 * Deletion is NOT covered here — see canDelete().
 */
export async function canEditModule(
  user: SessionUser,
  moduleSlug: string
): Promise<boolean> {
  if (user.role === "SUPERADMIN") return true;
  if (user.role === "USER") return false;
  if (user.role === "ADMIN" && isAdminEditableModule(moduleSlug)) return true;
  return hasAdminSectionAccess(user.id, moduleSlug);
}

/**
 * Check if user can DELETE. Only SUPERADMIN.
 * Actual DELETE endpoints still go through authorizeSuperadminDeletion()
 * for password re-auth + DeletionLog capture — this helper is for early
 * gating / UI visibility.
 */
export function canDelete(user: SessionUser): boolean {
  return user.role === "SUPERADMIN";
}

/**
 * Find all users with ADMIN role who have access to a specific module.
 * Used for sending notifications to the right ADMIN(s).
 */
export async function getModuleAdmins(moduleSlug: string): Promise<{
  id: string;
  name: string | null;
  telegramId: string | null;
}[]> {
  const assignments = await prisma.moduleAssignment.findMany({
    where: {
      module: { slug: moduleSlug, isActive: true },
      user: { role: "ADMIN" },
    },
    include: {
      user: {
        select: { id: true, name: true, telegramId: true },
      },
    },
  });
  return assignments.map((a) => a.user);
}

/**
 * Check if user can confirm a receipt.
 * SUPERADMIN always. ADMIN always — inventory is in ADMIN_EDITABLE_MODULES,
 * so no ModuleAssignment record is required. MANAGER/USER cannot confirm.
 *
 * The moduleSlug parameter is kept for API compatibility but is no longer
 * used for the access decision: receipt confirmation is scoped to the
 * inventory section, not to the individual business module.
 */
export async function canConfirmReceipt(
  user: SessionUser,
  _moduleSlug: string
): Promise<boolean> {
  if (user.role === "SUPERADMIN") return true;
  if (user.role !== "ADMIN") return false;
  // inventory is an ADMIN_EDITABLE_MODULE — any ADMIN can confirm receipts
  return canEditModule(user, "inventory");
}

/**
 * Check if user can correct a CONFIRMED receipt in the given module.
 * Same requirements as canConfirmReceipt.
 */
export async function canCorrectReceipt(
  user: SessionUser,
  moduleSlug: string
): Promise<boolean> {
  return canConfirmReceipt(user, moduleSlug);
}

/**
 * Check if user can flag a problem on a receipt.
 * MANAGER can flag their own receipts. ADMIN can flag any in their module.
 * SUPERADMIN can flag any.
 */
export async function canFlagProblem(
  user: SessionUser,
  moduleSlug: string,
  receiptPerformedById: string
): Promise<boolean> {
  if (user.role === "SUPERADMIN") return true;
  if (user.role === "ADMIN") return hasModuleAccess(user.id, moduleSlug);
  if (user.role === "MANAGER") {
    return user.id === receiptPerformedById && await hasModuleAccess(user.id, moduleSlug);
  }
  return false;
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
