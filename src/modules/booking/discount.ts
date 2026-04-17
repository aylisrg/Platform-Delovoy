import { prisma } from "@/lib/db";

// === Discount reason catalogue ===

export const DISCOUNT_REASONS = [
  "permanent_client",
  "corporate",
  "promo",
  "compensation",
  "other",
] as const;

export type DiscountReason = (typeof DISCOUNT_REASONS)[number];

export const DISCOUNT_REASON_LABELS: Record<DiscountReason, string> = {
  permanent_client: "Постоянный клиент",
  corporate: "Корпоративная скидка",
  promo: "Акция / промо",
  compensation: "Компенсация за неудобство",
  other: "Другое",
};

export const DEFAULT_MAX_DISCOUNT_PERCENT = 30;

// === Discount calculation ===

export function applyDiscount(
  originalAmount: number,
  discountPercent: number
): { discountAmount: number; finalAmount: number } {
  const discountAmount = Math.round(originalAmount * discountPercent / 100);
  const finalAmount = originalAmount - discountAmount;
  return { discountAmount, finalAmount };
}

// === Module config helper ===

export async function getMaxDiscountPercent(moduleSlug: string): Promise<number> {
  const mod = await prisma.module.findUnique({
    where: { slug: moduleSlug },
    select: { config: true },
  });
  const config = mod?.config as Record<string, unknown> | null;
  const maxPercent = config?.maxDiscountPercent;
  if (typeof maxPercent === "number" && maxPercent >= 1 && maxPercent <= 100) {
    return maxPercent;
  }
  return DEFAULT_MAX_DISCOUNT_PERCENT;
}
