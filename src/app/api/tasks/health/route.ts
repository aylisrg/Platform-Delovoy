import { apiResponse, apiServerError } from "@/lib/api-response";
import { prisma } from "@/lib/db";

/**
 * GET /api/tasks/health
 *
 * Module health probe: reports DB connectivity and inbound-email flag.
 * Public — surfaces nothing sensitive.
 */
export async function GET() {
  try {
    const [openTasks, unsentReminders] = await Promise.all([
      prisma.task.count({
        where: { status: { notIn: ["DONE", "CANCELLED"] } },
      }),
      prisma.task.count({
        where: {
          remindAt: { lte: new Date() },
          reminderSentAt: null,
          status: { notIn: ["DONE", "CANCELLED"] },
        },
      }),
    ]);

    return apiResponse({
      status: "ok",
      inboundEmail: process.env.INBOUND_EMAIL_ENABLED === "true",
      openTasks,
      unsentReminders,
    });
  } catch (err) {
    console.error("[GET /api/tasks/health]", err);
    return apiServerError("tasks module unhealthy");
  }
}
