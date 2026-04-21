import { NextRequest } from "next/server";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { runRentalPaymentReminders } from "@/modules/rental/scheduler";
import { timingSafeEqual } from "node:crypto";

function safeCompare(a: string, b: string): boolean {
  // Constant-time compare that also resists length-based timing probes:
  // always compare buffers of the same length, then AND the result with
  // the length-equality bit at the end.
  const maxLen = Math.max(a.length, b.length, 32);
  const aBuf = Buffer.alloc(maxLen);
  const bBuf = Buffer.alloc(maxLen);
  aBuf.write(a);
  bBuf.write(b);
  const equal = timingSafeEqual(aBuf, bBuf);
  return equal && a.length === b.length;
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
