import { createHmac } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { toISODate } from "@/lib/format";

export const dashboardEventSchema = z
  .object({
    event: z.enum([
      "dashboard_view",
      "dashboard_section_view",
      "booking_details_open",
      "booking_action_started",
      "contact_link_started",
      "feedback_open",
    ]),
    section: z
      .enum(["overview", "bookings", "orders", "feedback", "profile"])
      .optional(),
    action: z.enum(["cancel", "reschedule", "pay"]).optional(),
    channel: z.enum(["email", "phone", "telegram"]).optional(),
  })
  .strict();
type ClientEvent = z.infer<typeof dashboardEventSchema>;
type ServerEvent =
  | "booking_action_succeeded"
  | "booking_action_failed"
  | "contact_link_succeeded"
  | "contact_link_failed"
  | "notification_settings_save_succeeded"
  | "notification_settings_save_failed"
  | "feedback_reply_succeeded";

/** Account pseudonyms are stable across days; they are NOT visitor-day funnel sessions. */
export async function recordDashboardEvent(
  userId: string,
  event: ClientEvent["event"] | ServerEvent,
  metadata: Omit<ClientEvent, "event"> = {},
): Promise<void> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return;
  try {
    const safe = dashboardEventSchema.omit({ event: true }).parse(metadata);
    await prisma.productEvent.create({
      data: {
        funnel: "dashboard",
        moduleSlug: "profile",
        step: event,
        sessionKey: createHmac("sha256", secret)
          .update(`dashboard:${userId}`)
          .digest("hex"),
        metadata: safe,
      },
    });
  } catch {
    // Telemetry must not change the outcome of a customer operation or log PII.
    console.warn("[Dashboard analytics] Event could not be recorded");
  }
}

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Некорректная дата");
export const dashboardStatsSchema = z
  .object({ dateFrom: calendarDate, dateTo: calendarDate })
  .refine(
    (value) =>
      value.dateFrom <= value.dateTo &&
      value.dateTo <= toISODate(new Date()) &&
      (new Date(value.dateTo).getTime() - new Date(value.dateFrom).getTime()) /
        86400000 <=
        180,
    "Укажите период до 180 дней без будущих дат",
  );

export async function getDashboardEventStats(dateFrom: string, dateTo: string) {
  const from = new Date(`${dateFrom}T00:00:00+03:00`);
  const until = new Date(
    new Date(`${dateTo}T00:00:00+03:00`).getTime() + 86400000,
  );
  const rows = await prisma.$queryRaw<
    { event: string; events: bigint; accounts: bigint }[]
  >`
    SELECT step AS event, COUNT(*) AS events, COUNT(DISTINCT "sessionKey") AS accounts
    FROM "ProductEvent" WHERE funnel = 'dashboard' AND "createdAt" >= ${from} AND "createdAt" < ${until}
    GROUP BY step ORDER BY step
  `;
  return {
    dateFrom,
    dateTo,
    timezone: "Europe/Moscow" as const,
    rows: rows.map((row) => ({
      event: row.event,
      events: Number(row.events),
      accounts: Number(row.accounts),
    })),
  };
}
