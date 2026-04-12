import { prisma } from "@/lib/db";
import type { CheckInMetadata, NoShowMetadata } from "./types";

export function buildCheckInMetadata(managerId: string, now: Date): CheckInMetadata {
  return {
    checkedInAt: now.toISOString(),
    checkedInBy: managerId,
  };
}

export function buildNoShowMetadata(
  reason: "auto" | "manual",
  now: Date,
  actorId?: string
): NoShowMetadata & { noShowBy?: string } {
  return {
    noShowAt: now.toISOString(),
    noShowReason: reason,
    ...(actorId && { noShowBy: actorId }),
  };
}

/**
 * Returns IDs of CONFIRMED bookings that should be auto-marked NO_SHOW.
 * Condition: now >= startTime + noShowThresholdMinutes
 */
export async function findAutoNoShowCandidates(
  moduleSlug: string,
  noShowThresholdMinutes: number
): Promise<string[]> {
  const thresholdMs = noShowThresholdMinutes * 60 * 1000;
  const cutoffTime = new Date(Date.now() - thresholdMs);

  const bookings = await prisma.booking.findMany({
    where: {
      moduleSlug,
      status: "CONFIRMED",
      startTime: { lte: cutoffTime },
    },
    select: { id: true },
  });

  return bookings.map((b) => b.id);
}
