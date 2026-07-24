import { prisma } from "@/lib/db";
import { formatTime } from "@/lib/format";
import { enqueueNotification } from "./queue";

/**
 * Process all scheduled notifications.
 * Designed to be called periodically (e.g., every 5 minutes).
 */
export async function processScheduledNotifications(): Promise<void> {
  await Promise.allSettled([
    processBookingReminders(),
    processEndingSoonReminders(),
    processContractExpiryAlerts(),
  ]);
}

/**
 * За 1 час до ОКОНЧАНИЯ брони беседки — предложение продлить. Клиенту (если у
 * него есть канал) уходит уведомление, а в выделенный Telegram-канал беседок —
 * сообщение с контактом клиента и ссылкой на продление (dispatchModuleChannel).
 * Идемпотентно: NotificationLog по (entityId, "booking.ending_soon").
 */
async function processEndingSoonReminders(): Promise<void> {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  try {
    const bookings = await prisma.booking.findMany({
      where: {
        moduleSlug: "gazebos",
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
        endTime: { gte: now, lte: oneHourFromNow },
      },
    });

    for (const booking of bookings) {
      const alreadySent = await prisma.notificationLog.findFirst({
        where: {
          entityId: booking.id,
          eventType: "booking.ending_soon",
          status: "SENT",
        },
      });
      if (alreadySent) continue;

      const resource = await prisma.resource.findUnique({
        where: { id: booking.resourceId },
        select: { name: true },
      });

      const data = {
        resourceName: resource?.name || "Беседка",
        date: booking.date.toLocaleDateString("ru-RU"),
        // ISO-дата для deep-link в расписание админки (?date=YYYY-MM-DD).
        dateISO: booking.date.toISOString().split("T")[0],
        startTime: formatTime(booking.startTime),
        endTime: formatTime(booking.endTime),
        clientName: booking.clientName ?? undefined,
        clientPhone: booking.clientPhone ?? undefined,
        bookingId: booking.id,
      };

      enqueueNotification({
        type: "booking.ending_soon",
        moduleSlug: booking.moduleSlug,
        entityId: booking.id,
        userId: booking.userId ?? undefined,
        data,
      });

      // Гостевые брони не имеют клиентской доставки, которая пишет SENT-лог,
      // поэтому фиксируем здесь — иначе канал получал бы дубль на каждом запуске
      // планировщика в пределах часового окна.
      if (!booking.userId) {
        await prisma.notificationLog.create({
          data: {
            channel: "TELEGRAM",
            eventType: "booking.ending_soon",
            moduleSlug: booking.moduleSlug,
            entityId: booking.id,
            recipient: "module-channel",
            message: `Скоро конец: ${data.resourceName}, ${data.date} до ${data.endTime}`,
            status: "SENT",
            sentAt: new Date(),
          },
        });
      }
    }
  } catch (err) {
    console.error("[Scheduler] Ending-soon reminders failed:", err);
  }
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

      const data = {
        resourceName: resource?.name || "Ресурс",
        date: booking.date.toLocaleDateString("ru-RU"),
        startTime: formatTime(booking.startTime),
        endTime: formatTime(booking.endTime),
      };

      enqueueNotification({
        type: "booking.reminder",
        moduleSlug: booking.moduleSlug,
        entityId: booking.id,
        userId: booking.userId ?? undefined,
        data,
      });

      // Guest bookings have no client delivery to write a SENT log, so mark
      // the reminder here — otherwise the module Telegram channel would get a
      // duplicate on every scheduler run within the hour window.
      if (!booking.userId) {
        await prisma.notificationLog.create({
          data: {
            channel: "TELEGRAM",
            eventType: "booking.reminder",
            moduleSlug: booking.moduleSlug,
            entityId: booking.id,
            recipient: "module-channel",
            message: `Напоминание: ${data.resourceName}, ${data.date} ${data.startTime}–${data.endTime}`,
            status: "SENT",
            sentAt: new Date(),
          },
        });
      }
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
