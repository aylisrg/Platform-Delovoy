import { prisma } from "@/lib/db";

export type RecipientInfo = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  hasTelegramChannel: boolean;
  isSelected: boolean;
};

/**
 * Returns the full list of userIds who should receive admin notifications for
 * a given module. Always includes every SUPERADMIN. Optionally includes ADMIN /
 * MANAGER users listed in Module.config.notificationRecipients.
 */
export async function getRecipientUserIds(moduleSlug: string): Promise<string[]> {
  const [superadmins, mod] = await Promise.all([
    prisma.user.findMany({
      where: { role: "SUPERADMIN" },
      select: { id: true },
    }),
    prisma.module.findUnique({
      where: { slug: moduleSlug },
      select: { config: true },
    }),
  ]);

  const superadminIds = superadmins.map((u) => u.id);
  const config = mod?.config as Record<string, unknown> | null;
  const extra = (config?.notificationRecipients as string[] | undefined) ?? [];

  return [...new Set([...superadminIds, ...extra])];
}

/**
 * Persists the selected recipient userIds into Module.config.notificationRecipients.
 * Only ADMIN / MANAGER users with the required module access are accepted.
 * SUPERADMIN entries are silently ignored (they always receive notifications).
 */
export async function setRecipientUserIds(
  moduleSlug: string,
  userIds: string[]
): Promise<void> {
  if (userIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, role: { in: ["ADMIN", "MANAGER"] } },
      select: { id: true, role: true },
    });
    const validIds = new Set(users.map((u) => u.id));

    // MANAGER must have a ModuleAssignment to this module
    const managerIds = users
      .filter((u) => u.role === "MANAGER")
      .map((u) => u.id);
    if (managerIds.length > 0) {
      const mod = await prisma.module.findUnique({
        where: { slug: moduleSlug },
        select: { id: true },
      });
      if (mod) {
        const assignments = await prisma.moduleAssignment.findMany({
          where: { moduleId: mod.id, userId: { in: managerIds } },
          select: { userId: true },
        });
        const assignedIds = new Set(assignments.map((a) => a.userId));
        for (const mid of managerIds) {
          if (!assignedIds.has(mid)) validIds.delete(mid);
        }
      }
    }

    userIds = [...validIds];
  }

  // Read current config to merge — Prisma JSON updates replace the whole field
  const current = await prisma.module.findUnique({
    where: { slug: moduleSlug },
    select: { config: true },
  });
  const currentConfig = (current?.config as Record<string, unknown>) ?? {};

  await prisma.module.update({
    where: { slug: moduleSlug },
    data: {
      config: { ...currentConfig, notificationRecipients: userIds },
    },
  });
}

/**
 * Lists all users eligible to receive per-module notifications:
 * SUPERADMINs + ADMINs + MANAGERs assigned to the module.
 */
export async function listEligibleRecipients(
  moduleSlug: string
): Promise<RecipientInfo[]> {
  const mod = await prisma.module.findUnique({
    where: { slug: moduleSlug },
    select: {
      id: true,
      config: true,
      assignments: { select: { userId: true } },
    },
  });

  const config = mod?.config as Record<string, unknown> | null;
  const selectedIds = new Set<string>(
    (config?.notificationRecipients as string[] | undefined) ?? []
  );
  const assignedManagerIds = new Set((mod?.assignments ?? []).map((a) => a.userId));

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { role: { in: ["SUPERADMIN", "ADMIN"] } },
        { role: "MANAGER", id: { in: [...assignedManagerIds] } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      notificationChannels: {
        where: { kind: "TELEGRAM", isActive: true },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });

  return users.map((u) => ({
    userId: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    hasTelegramChannel: u.notificationChannels.length > 0,
    isSelected: u.role === "SUPERADMIN" || selectedIds.has(u.id),
  }));
}
