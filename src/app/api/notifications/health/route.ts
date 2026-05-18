import { NextResponse } from "next/server";
import { notificationsHealth } from "@/modules/notifications/health";

/**
 * GET /api/notifications/health
 *
 * Public health check for the Telegram notification pipeline.
 * Used by deploy smoke tests — returns 200 when everything is operational,
 * 503 when the bot token or admin chat is misconfigured/unreachable.
 *
 * ok=false does NOT mean the app is broken — notifications degrade gracefully.
 * The deploy pipeline treats this as a warning-only signal.
 */
export async function GET() {
  try {
    const health = await notificationsHealth();
    return NextResponse.json(
      { success: true, data: health },
      { status: health.ok ? 200 : 503 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        data: { ok: false },
        error: error instanceof Error ? error.message : "health check failed",
      },
      { status: 503 }
    );
  }
}
