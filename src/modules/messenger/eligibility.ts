import { prisma } from "@/lib/db";
import type { EligibilityResult } from "./types";

/**
 * Determines if userA can start a DIRECT chat with userB.
 *
 * Allowed when at least one of:
 * 1. Both users have Bookings on the same resourceId (shared office/gazebo/space).
 * 2. An admin already created a GROUP chat that includes both users.
 *
 * Note: RentalContract links to Tenant (a business entity), not directly to User,
 * so co-tenant eligibility is approximated via shared Booking resourceId.
 */
export async function canStartDirect(
  userIdA: string,
  userIdB: string,
): Promise<EligibilityResult> {
  if (userIdA === userIdB) {
    return { ok: false, reason: "no_shared_connection" };
  }

  // 1. Shared resource via Booking (both users booked the same office/space).
  const bookingsA = await prisma.booking.findMany({
    where: { userId: userIdA, deletedAt: null },
    select: { resourceId: true },
  });
  const resourceIdsA = bookingsA.map((b) => b.resourceId);

  if (resourceIdsA.length > 0) {
    const sharedBooking = await prisma.booking.findFirst({
      where: {
        userId: userIdB,
        resourceId: { in: resourceIdsA },
        deletedAt: null,
      },
    });
    if (sharedBooking) {
      return { ok: true, reason: "shared_office" };
    }
  }

  // 2. Admin-created GROUP chat that includes both users.
  const sharedGroupChat = await prisma.chat.findFirst({
    where: {
      kind: "GROUP",
      participants: {
        some: { userId: userIdA, leftAt: null },
      },
      AND: [
        {
          participants: {
            some: { userId: userIdB, leftAt: null },
          },
        },
      ],
    },
  });
  if (sharedGroupChat) {
    return { ok: true, reason: "admin_created" };
  }

  return { ok: false, reason: "no_shared_connection" };
}
