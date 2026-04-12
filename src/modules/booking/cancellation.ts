import type { CancellationPolicy, CancellationResult } from "./types";

/**
 * Computes whether a cancellation penalty applies.
 *
 * Rules:
 * - skipPolicy = true (manager/superadmin): always free
 * - hoursUntilStart >= policy.thresholdHours: always free
 * - hoursUntilStart < policy.thresholdHours AND basePrice > 0: penalty applies
 */
export function computeCancellationPenalty(
  startTime: Date,
  now: Date,
  basePrice: number,
  policy: CancellationPolicy,
  skipPolicy: boolean
): CancellationResult {
  if (skipPolicy) {
    return { penaltyApplied: false };
  }

  const msUntilStart = startTime.getTime() - now.getTime();
  const hoursUntilStart = msUntilStart / (1000 * 60 * 60);

  if (hoursUntilStart >= policy.thresholdHours) {
    return { penaltyApplied: false };
  }

  if (basePrice <= 0) {
    return { penaltyApplied: false };
  }

  const penaltyAmount = Math.round((basePrice * policy.penaltyPercent) / 100);
  return { penaltyApplied: true, penaltyAmount, basePrice };
}
