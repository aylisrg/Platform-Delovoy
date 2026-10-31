import { prisma } from "@/lib/db";
/** Re-read role and grants: stale JWTs and merged accounts never grant financial access. */
export async function getBusinessViewer(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, mergedIntoUserId: true, telegramId: true, adminPermissions: { where: { section: "analytics" }, select: { section: true } } },
  });
  if (!user || user.mergedIntoUserId || (user.role !== "SUPERADMIN" && !(user.role === "ADMIN" && user.adminPermissions.length > 0))) return null;
  return user;
}
