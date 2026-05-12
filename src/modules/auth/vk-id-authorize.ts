/**
 * Post-signIn hook for VK ID OAuth.
 *
 * Called from auth.ts signIn callback when provider === "vk-id".
 * Handles three things the PrismaAdapter cannot do automatically:
 *   1. Write User.vkId, User.source, User.phone/phoneNormalized
 *   2. Auto-merge with pre-existing accounts sharing the same phone or email
 *   3. Create UserNotificationChannel(kind=VK) for the notifications pipeline
 */
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { autoMergeOnLogin } from "@/modules/auth/auto-merge";
import type { AutoMergeCandidate } from "@/modules/auth/auto-merge";
import type { VkIdProfile } from "@/lib/auth-providers/vk-id";

export async function handleVkIdSignIn(
  userId: string,
  profile: VkIdProfile
): Promise<void> {
  const u = profile.user;
  const vkId = String(u.id);
  const phone = normalizePhone(u.phone ?? null);
  const emailNorm = u.email ? u.email.toLowerCase().trim() : null;

  await prisma.user.update({
    where: { id: userId },
    data: {
      vkId,
      source: "vk_id",
      ...(phone ? { phone, phoneNormalized: phone } : {}),
      ...(emailNorm ? { emailNormalized: emailNorm } : {}),
      ...(u.avatar ? { image: u.avatar } : {}),
    },
  });

  // Create VK notification channel if community token is configured.
  // Requires the user to open the community dialog before messages can
  // be sent (VK API error 901 otherwise — handled in the channel layer).
  if (process.env.VK_COMMUNITY_TOKEN) {
    await prisma.userNotificationChannel.upsert({
      where: {
        userId_kind_address: { userId, kind: "VK", address: vkId },
      },
      create: {
        userId,
        kind: "VK",
        address: vkId,
        label: "VK",
        priority: 90,
        isActive: true,
      },
      update: {},
    });
  }

  // Build auto-merge candidates list from phone + email matches.
  const excludeIds = new Set([userId]);
  const candidates: AutoMergeCandidate[] = [];

  if (phone) {
    const byPhone = await prisma.user.findMany({
      where: {
        phoneNormalized: phone,
        id: { notIn: [...excludeIds] },
        mergedIntoUserId: null,
      },
      select: { id: true, role: true },
    });
    for (const c of byPhone) {
      candidates.push({ id: c.id, role: c.role, matchedBy: "phone" });
      excludeIds.add(c.id);
    }
  }

  if (emailNorm) {
    const byEmail = await prisma.user.findMany({
      where: {
        emailNormalized: emailNorm,
        id: { notIn: [...excludeIds] },
        mergedIntoUserId: null,
      },
      select: { id: true, role: true },
    });
    for (const c of byEmail) {
      candidates.push({ id: c.id, role: c.role, matchedBy: "email" });
      excludeIds.add(c.id);
    }
  }

  if (candidates.length > 0) {
    await autoMergeOnLogin({
      primaryUserId: userId,
      candidates,
      provider: "vk-id",
    });
  }
}
