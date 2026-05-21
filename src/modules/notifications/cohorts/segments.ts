import type { PrismaClient } from "@prisma/client";

export type SegmentKey =
  | "active_office_tenants"
  | "ps_park_guests_90d"
  | "gazebo_guests_180d"
  | "all_verified_users";

export const SEGMENT_LABELS: Record<SegmentKey, string> = {
  active_office_tenants: "Активные арендаторы офисов",
  ps_park_guests_90d: "Клиенты PS-парка (90 дней)",
  gazebo_guests_180d: "Гости беседок (180 дней)",
  all_verified_users: "Все верифицированные пользователи",
};

/** Users with an ACTIVE RentalContract, matched by Tenant.email → User.email */
export async function activeOfficeTenantsSegment(prisma: PrismaClient): Promise<string[]> {
  const contracts = await prisma.rentalContract.findMany({
    where: { status: "ACTIVE" },
    select: { tenant: { select: { email: true } } },
  });

  const emails = contracts
    .map((c) => c.tenant.email?.toLowerCase())
    .filter((e): e is string => Boolean(e));

  if (!emails.length) return [];

  const users = await prisma.user.findMany({
    where: {
      emailNormalized: { in: emails },
      mergedIntoUserId: null,
    },
    select: { id: true },
  });

  return users.map((u) => u.id);
}

/** Users who booked PS-park in the last 90 days */
export async function psParkGuests90dSegment(prisma: PrismaClient): Promise<string[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const bookings = await prisma.booking.findMany({
    where: {
      moduleSlug: "ps-park",
      userId: { not: null },
      deletedAt: null,
      createdAt: { gte: since },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  return bookings.map((b) => b.userId!);
}

/** Users who booked gazebos in the last 180 days */
export async function gazeboGuests180dSegment(prisma: PrismaClient): Promise<string[]> {
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const bookings = await prisma.booking.findMany({
    where: {
      moduleSlug: "gazebos",
      userId: { not: null },
      deletedAt: null,
      createdAt: { gte: since },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  return bookings.map((b) => b.userId!);
}

/** All users with a verified email and no merge (active accounts) */
export async function allVerifiedUsersSegment(prisma: PrismaClient): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      role: "USER",
      emailVerified: { not: null },
      mergedIntoUserId: null,
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export const SEGMENT_RESOLVERS: Record<
  SegmentKey,
  (prisma: PrismaClient) => Promise<string[]>
> = {
  active_office_tenants: activeOfficeTenantsSegment,
  ps_park_guests_90d: psParkGuests90dSegment,
  gazebo_guests_180d: gazeboGuests180dSegment,
  all_verified_users: allVerifiedUsersSegment,
};
