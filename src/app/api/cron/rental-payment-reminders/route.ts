import { NextRequest } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { runRentalPaymentReminders } from "@/modules/rental/scheduler";


export async function GET(request: NextRequest) {
  try {
    const denied = verifyCronRequest(request);
    if (denied) return denied;

    const report = await runRentalPaymentReminders();
    return apiResponse({ timestamp: new Date().toISOString(), report });
  } catch (err) {
    console.error("[Cron] Rental reminders failed:", err);
    return apiServerError();
  }
}
