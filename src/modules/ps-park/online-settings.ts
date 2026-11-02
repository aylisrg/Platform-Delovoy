import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashDocumentBody } from "@/modules/booking/offer";
import { isYooKassaConfigured } from "@/lib/yookassa/client";
import { receiptsEnabled, resolveVatCode } from "@/lib/yookassa/receipts";

/** Explicit release/rollback operation. Does not change credentials or other modules. */
export async function setOnlineBookingEnabled(actorId: string, enabled: boolean, expectedOfferHash?: string) {
  return prisma.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, mergedIntoUserId: true } });
    if (actor?.role !== "SUPERADMIN" || actor.mergedIntoUserId) throw new Error("SUPERADMIN_REQUIRED");
    await tx.$executeRaw`SELECT 1 FROM "Module" WHERE slug = 'ps-park' FOR UPDATE`;
    const park = await tx.module.findUnique({ where: { slug: "ps-park" } });
    if (!park) throw new Error("PS_PARK_NOT_FOUND");
    if (enabled) {
      if (!park.isActive || !isYooKassaConfigured() || !process.env.YOOKASSA_WEBHOOK_SECRET) throw new Error("PAYMENTS_NOT_CONFIGURED");
      if (receiptsEnabled()) resolveVatCode();
      const now = new Date();
      const offer = await tx.offerVersion.findFirst({ where: {
        documentKey: "ps-park-offer", isCurrent: true, publishedAt: { lte: now }, effectiveAt: { lte: now },
      } });
      if (!expectedOfferHash || !offer || offer.contentHash !== expectedOfferHash || hashDocumentBody(offer.body) !== expectedOfferHash) {
        throw new Error("PUBLISHED_OFFER_MISMATCH");
      }
    }
    const config = (park.config as Record<string, Prisma.InputJsonValue> | null) ?? {};
    if (config.onlineBookingEnabled === enabled) return { onlineBookingEnabled: enabled, changed: false };
    await tx.module.update({ where: { slug: "ps-park" }, data: { config: { ...config, onlineBookingEnabled: enabled } } });
    await tx.auditLog.create({ data: {
      userId: actorId, action: "ps-park.online-booking", entity: "Module", entityId: park.id,
      metadata: { onlineBookingEnabled: enabled, ...(enabled && { offerContentHash: expectedOfferHash }) },
    } });
    return { onlineBookingEnabled: enabled, changed: true };
  });
}
