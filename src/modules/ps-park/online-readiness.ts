import type { Prisma } from "@prisma/client";
import { hashDocumentBody } from "@/modules/booking/offer";
import { isYooKassaConfigured } from "@/lib/yookassa/client";
import { receiptsEnabled, resolveVatCode } from "@/lib/yookassa/receipts";

/** Shared preflight only; callers retain their own authorization and transaction. */
export async function assertOnlineBookingReady(
  tx: Pick<Prisma.TransactionClient, "offerVersion">,
  park: { isActive: boolean },
  expectedOfferHash?: string,
): Promise<void> {
  if (!park.isActive || !isYooKassaConfigured() || !process.env.YOOKASSA_WEBHOOK_SECRET) {
    throw new Error("PAYMENTS_NOT_CONFIGURED");
  }
  if (receiptsEnabled()) resolveVatCode();
  const now = new Date();
  const offer = await tx.offerVersion.findFirst({ where: {
    documentKey: "ps-park-offer", isCurrent: true, publishedAt: { lte: now }, effectiveAt: { lte: now },
  } });
  if (!expectedOfferHash || !offer || offer.contentHash !== expectedOfferHash || hashDocumentBody(offer.body) !== expectedOfferHash) {
    throw new Error("PUBLISHED_OFFER_MISMATCH");
  }
}
