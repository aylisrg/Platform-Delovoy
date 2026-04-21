import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { runRentalPaymentReminders } from "@/modules/rental/scheduler";
import { timingSafeEqual } from "node:crypto";

function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function GET(request: NextRequest) {
  try {
    const token =
      request.nextUrl.searchParams.get("token") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
      "";
    const cronSecret = process.env.CRON_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
    if (!cronSecret || !safeCompare(token, cronSecret)) {
      return apiError("UNAUTHORIZED", "Invalid cron token", 401);
    }

    const report = await runRentalPaymentReminders();
    return apiResponse({ timestamp: new Date().toISOString(), report });
  } catch (err) {
    console.error("[Cron] Rental reminders failed:", err);
    return apiServerError();
  }
}
