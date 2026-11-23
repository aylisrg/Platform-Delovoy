import { prisma } from "@/lib/db";
import { formatTime } from "@/lib/format";
import { enqueueNotification } from "./queue";
import { processTelephonyDailySummaries } from "@/modules/telephony/daily-summary-service";
import { processTelephonyTelegramSummaries } from "@/modules/telephony/daily-summary-telegram";
import { runNotificationHousekeeping } from "./housekeeping";
import { processWeeklyBusinessReports } from "@/modules/analytics/business-reports";
import { processWeeklyDigest } from "./weekly-digest";
import { processStaffLaunchAnnouncement } from "./staff-launch-announcement";
import { getSessionAlertMinutes } from "@/modules/ps-park/service";

/**
 * Process all scheduled notifications.
 * Designed to be called periodically (e.g., every 5 minutes).
 */
export async function processScheduledNotifications(): Promise<void> {
  await Promise.allSettled([
    processWeeklyBusinessReports().catch(() => {
      console.error("[Scheduler] Business weekly report processing failed");
    }),
    processWeeklyDigest().catch(() => {
      // No recipient ids or provider payload in logs; claims make the next run safe.
      console.error("[Scheduler] Weekly digest processing failed");
    }),
    processStaffLaunchAnnouncement().catch(() => {
      // One-off staff announcement; claims make the next run safe.
      console.error("[Scheduler] Staff launch announcement failed");
    }),
    processBookingReminders(),
    processEndingSoonReminders(),
    processContractExpiryAlerts(),
    processTelephonyDailySummaries().catch(() => {
      // No provider payload/PII in logs; the next five-minute run retries.
      console.error("[Scheduler] Telephony daily summary failed; retry on next run");
    }),
    processTelephonyTelegramSummaries().catch(() => {
      // Aggregates only; no claim is written before the report is complete.
      console.error("[Scheduler] Telephony Telegram summary failed; retry on next run");
    }),
    runNotificationHousekeeping().catch((err) => {
      console.error("[Scheduler] Notification housekeeping failed:", err instanceof Error ? err.message : err);
    }),
  ]);
}

/**
 * Предложение продлить бронь клиенту и смене. Беседки предупреждаем за час,
 * сессии Плей Парка — по настройке, с учётом пятиминутного интервала cron.
 */
async function processEndingSoonReminders(): Promise<void> {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  try {
    const bookings = await prisma.booking.findMany({
      where: {
        moduleSlug: { in: ["gazebos", "ps-park"] },
        deletedAt: null,
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
        endTime: { gte: now, lte: oneHourFromNow },
      },
    });

    const psAlertMinutes = bookings.some((booking) => booking.moduleSlug === "ps-park")
      ? await getSessionAlertMinutes()
      : 0;
    for (const booking of bookings) {
      const playPark = booking.moduleSlug === "ps-park";
      if (playPark && (booking.startTime > now || booking.endTime <= now ||
          booking.endTime.getTime() - now.getTime() > Math.max(psAlertMinutes, 5) * 60_000)) continue;
      // Новое время окончания (после продления или переноса) — новый алерт.
      const markerId = playPark ? `ps-park:ending:${booking.id}:${booking.endTime.toISOString()}` : null;
      const alreadySent = await prisma.notificationLog.findFirst({
        where: {
          ...(markerId && { id: markerId }),
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
        resourceName: resource?.name || (playPark ? "Игровой стол" : "Беседка"),
        date: booking.date.toLocaleDateString("ru-RU"),
        // ISO-дата для deep-link в расписание админки (?date=YYYY-MM-DD).
        dateISO: booking.date.toISOString().split("T")[0],
        startTime: formatTime(booking.startTime),
        endTime: formatTime(booking.endTime),
        clientName: booking.clientName ?? undefined,
        clientPhone: booking.clientPhone ?? undefined,
        bookingId: booking.id,
      };

      const marker = {
        channel: "TELEGRAM",
        eventType: "booking.ending_soon",
        moduleSlug: booking.moduleSlug,
        entityId: booking.id,
        recipient: booking.userId || playPark ? "scheduler" : "module-channel",
        message: `Скоро конец: ${data.resourceName}, ${data.date} до ${data.endTime}`,
        status: "SENT",
        sentAt: now,
      } as const;
      if (markerId) {
        const claim = await prisma.notificationLog.createMany({
          data: { id: markerId, ...marker },
          skipDuplicates: true,
        });
        if (!claim.count) continue;
      }

      enqueueNotification({
        type: "booking.ending_soon",
        moduleSlug: booking.moduleSlug,
        entityId: booking.id,
        userId: booking.userId ?? undefined,
        data,
      });
      if (markerId) continue;

      // Маркер пишем всегда: у гостевой брони нет клиентской доставки с
      // SENT-логом, а у клиента без канала лог будет SKIPPED — без маркера канал
      // смены и лично подписанные сотрудники получали бы дубль на каждом
      // запуске планировщика в пределах часового окна.
      await prisma.notificationLog.create({ data: marker });
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
        deletedAt: null,
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
 * Идемпотентно: не больше одного раза на договор, с учётом и NotificationLog
 * (групповой чат), и OutgoingNotification (очередь dispatch).
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

      // Получатели, настроенные явно или подписанные сами, идут через очередь
      // dispatch: там пишется OutgoingNotification, а NotificationLog нет.
      // Без этой проверки каждый прогон крона (раз в 5 мин) ставил алерт
      // заново, а 5-минутное окно dedup в dispatch() его не ловило. Учитываем
      // и FAILED: повтор упавшей отправки делает сама очередь (ретрай и
      // фолбэк), а не планировщик.
      const alreadyQueued = await prisma.outgoingNotification.findFirst({
        where: {
          entityId: contract.id,
          eventType: "contract.expiring",
          status: { in: ["PENDING", "DEFERRED", "SENT", "FAILED"] },
        },
        select: { id: true },
      });
      if (alreadyQueued) continue;

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
