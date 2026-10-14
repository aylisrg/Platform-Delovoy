import { NextRequest } from "next/server";
import { apiResponse, apiServerError } from "@/lib/api-response";
import { syncItemsRegistry, syncAccount } from "@/lib/avito";
import { verifyCronRequest } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

/**
 * POST/GET /api/cron/avito-account-sync — refresh items registry + account
 * (avitoUserId, balance) from Avito Core API.
 * Schedule: every hour.
 * Gated by AVITO_CRON_ENABLED=true.
 */
export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}

async function run(request: NextRequest) {
  try {
    const denied = verifyCronRequest(request, { route: "avito-account-sync" });
    if (denied) return denied;

    if (process.env.AVITO_CRON_ENABLED !== "true") {
      return apiResponse({ skipped: true, reason: "AVITO_CRON_ENABLED is not set to 'true'" });
    }

    const itemsResult = await syncItemsRegistry();
    await syncAccount();
    return apiResponse({ items: itemsResult });
  } catch (err) {
    console.error("[cron avito-account-sync] error", err);
    return apiServerError();
  }
}
