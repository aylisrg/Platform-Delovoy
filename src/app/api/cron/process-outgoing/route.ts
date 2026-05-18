import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { apiResponse, apiError, apiServerError } from "@/lib/api-response";
import { processOutgoing } from "@/modules/notifications/dispatch/dispatcher";
import { log } from "@/lib/logger";

function safeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length, 32);
  const aBuf = Buffer.alloc(maxLen);
  const bBuf = Buffer.alloc(maxLen);
  aBuf.write(a);
  bBuf.write(b);
  return timingSafeEqual(aBuf, bBuf) && a.length === b.length;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  if (!cronSecret) {
    return apiError("SERVICE_UNAVAILABLE", "CRON_SECRET is not configured", 503);
  }

  const token =
    request.nextUrl.searchParams.get("token") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (!safeCompare(token, cronSecret)) {
    return apiError("UNAUTHORIZED", "Invalid cron token", 401);
  }

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
