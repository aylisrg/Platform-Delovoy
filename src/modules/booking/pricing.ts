import type { PricingResult } from "./types";

/**
 * Computes basePrice and totalPrice at booking creation time.
 * Snapshots pricePerHour from resource — future price changes won't affect this booking.
 */
export function computeBookingPricing(
  startTime: Date,
  endTime: Date,
  pricePerHour: number | null,
  itemsTotal: number
): PricingResult {
  const hours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
  const rate = pricePerHour ?? 0;
  const basePrice = Math.round(hours * rate * 100) / 100;
  const totalPrice = Math.round((basePrice + itemsTotal) * 100) / 100;

  return {
    pricePerHour: rate.toFixed(2),
    basePrice: basePrice.toFixed(2),
    totalPrice: totalPrice.toFixed(2),
  };
}
