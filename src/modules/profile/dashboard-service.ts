import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getBookingPaymentSummary } from "@/modules/booking/payment-status";

export const DASHBOARD_PAGE_SIZE = 10;
const ACTIVE_STATUSES = ["PENDING", "CONFIRMED"] as const;

export function bookingWhere(
  userId: string,
  active: boolean,
  now: Date,
): Prisma.BookingWhereInput {
  const current: Prisma.BookingWhereInput = {
    OR: [
      { status: { in: [...ACTIVE_STATUSES] }, endTime: { gte: now } },
      { status: "CHECKED_IN" },
    ],
  };
  return { userId, deletedAt: null, ...(active ? current : { NOT: current }) };
}

export async function getDashboardBookings(
  userId: string,
  active: boolean,
  page = 1,
  now = new Date(),
) {
  const where = bookingWhere(userId, active, now);
  const [total, bookings] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: [{ startTime: active ? "asc" : "desc" }, { id: "asc" }],
      skip: (page - 1) * DASHBOARD_PAGE_SIZE,
      take: DASHBOARD_PAGE_SIZE,
    }),
  ]);
  const resources = await prisma.resource.findMany({
    where: { id: { in: [...new Set(bookings.map((b) => b.resourceId))] } },
    select: { id: true, name: true },
  });
  const names = new Map(resources.map((r) => [r.id, r.name]));
  return {
    total,
    bookings: bookings.map((b) => ({
      id: b.id,
      moduleSlug: b.moduleSlug,
      status: b.status,
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime,
      resourceName: names.get(b.resourceId) ?? "Место бронирования",
      payment: getBookingPaymentSummary(b),
    })),
  };
}

export async function getDashboardOrders(userId: string, page = 1) {
  const where = { userId, deletedAt: null };
  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: { items: { orderBy: { id: "asc" } } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_PAGE_SIZE,
      skip: (page - 1) * DASHBOARD_PAGE_SIZE,
    }),
  ]);
  return { total, orders };
}

export async function getDashboardFeedback(userId: string, page = 1) {
  const [total, items] = await Promise.all([
    prisma.feedbackItem.count({ where: { userId } }),
    prisma.feedbackItem.findMany({
      where: { userId },
      include: { comments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: DASHBOARD_PAGE_SIZE,
      skip: (page - 1) * DASHBOARD_PAGE_SIZE,
    }),
  ]);
  const authors = await prisma.user.findMany({
    where: {
      id: {
        in: [
          ...new Set(
            items.flatMap((item) => item.comments.map((c) => c.authorId)),
          ),
        ],
      },
    },
    select: { id: true, name: true },
  });
  const names = new Map(authors.map((u) => [u.id, u.name]));
  return {
    total,
    items: items.map((item) => ({
      ...item,
      comments: item.comments.map((c) => ({
        ...c,
        authorLabel:
          c.authorId === userId
            ? "Вы"
            : (names.get(c.authorId) ?? "Сотрудник парка"),
      })),
    })),
  };
}
