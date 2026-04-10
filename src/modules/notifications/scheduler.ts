import { prisma } from "@/lib/db";
import { enqueueNotification } from "./queue";

/**
 * Process all scheduled notifications.
 * Designed to be called periodically (e.g., every 5 minutes).
 */
export async function processScheduledNotifications(): Promise<void> {
  await Promise.allSettled([
    processBookingReminders(),
    processContractExpiryAlerts(),
  ]);
}

/**
 * Send reminders for confirmed bookings starting within the next hour.
 * Idempotent: checks NotificationLog to avoid duplicate sends.
 */
async function processBookingReminders(): Promise<void> {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  try {
    const bookings = await prisma.booking.findMany({
      where: {
        status: "CONFIRMED",
        startTime: { gte: now, lte: oneHourFromNow },
      },
      include: {
        user: {
          select: { name: true },
        },
      },
    });

    for (const booking of bookings) {
      // Check if reminder already sent
      const alreadySent = await prisma.notificationLog.findFirst({
        where: {
          entityId: booking.id,
          eventType: "booking.reminder",
          status: "SENT",
        },
      });
      if (alreadySent) continue;

      // Fetch resource name
      const resource = await prisma.resource.findUnique({
        where: { id: booking.resourceId },
        select: { name: true },
      });

      enqueueNotification({
        type: "booking.reminder",
        moduleSlug: booking.moduleSlug,
        entityId: booking.id,
        userId: booking.userId,
        data: {
          resourceName: resource?.name || "Ресурс",
          date: booking.date.toLocaleDateString("ru-RU"),
          startTime: booking.startTime.toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      });
    }
  } catch (err) {
    console.error("[Scheduler] Booking reminders failed:", err);
  }
}

/**
 * Send alerts for contracts expiring within 30 days.
 * Idempotent: sends max once per contract.
 */
async function processContractExpiryAlerts(): Promise<void> {
  const now = new Date();
  const thirtyDaysFromNow = new Date(
    now.getTime() + 30 * 24 * 60 * 60 * 1000
  );

  try {
    const contracts = await prisma.rentalContract.findMany({
      where: {
        status: { in: ["ACTIVE", "EXPIRING"] },
        endDate: { gte: now, lte: thirtyDaysFromNow },
      },
      include: {
        tenant: { select: { companyName: true } },
        office: { select: { number: true } },
      },
    });

    for (const contract of contracts) {
      const alreadySent = await prisma.notificationLog.findFirst({
        where: {
          entityId: contract.id,
          eventType: "contract.expiring",
          status: "SENT",
        },
      });
      if (alreadySent) continue;

      const daysLeft = Math.ceil(
        (contract.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      enqueueNotification({
        type: "contract.expiring",
        moduleSlug: "rental",
        entityId: contract.id,
        data: {
          tenantName: contract.tenant.companyName,
          officeNumber: contract.office.number,
          endDate: contract.endDate.toLocaleDateString("ru-RU"),
          daysLeft,
          monthlyRate: contract.monthlyRate.toString(),
        },
      });
    }
  } catch (err) {
    console.error("[Scheduler] Contract expiry alerts failed:", err);
  }
}
