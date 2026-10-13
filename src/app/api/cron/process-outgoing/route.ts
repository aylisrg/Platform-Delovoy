import { NextRequest } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { processOutgoing } from "@/modules/notifications/dispatch/dispatcher";
import { log } from "@/lib/logger";


export async function GET(request: NextRequest) {
  const denied = verifyCronRequest(request);
  if (denied) return denied;

  try {
    const result = await processOutgoing(100);
    void log.info("cron.processOutgoing", "Outgoing batch processed", result);
    return apiResponse({
      processedAt: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Cron] process-outgoing failed:", err);
    void log.error("cron.processOutgoing", `Batch failed: ${msg}`);
    return apiServerError();
  }
}
