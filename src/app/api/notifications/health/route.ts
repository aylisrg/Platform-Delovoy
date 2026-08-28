import { NextResponse } from "next/server";
import { EVENT_SOURCES } from "@/lib/event-sources";
import { log } from "@/lib/logger";
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
 *
 * Молчащий контур owner-decisions алертит отдельно: `log.critical()` сам
 * троттлит по source раз в 300с (Redis), так что частый опрос этого роута
 * (`site-watchdog.yml` раз в 5 мин, `local-watchdog.sh` раз в минуту) не
 * спамит админ-чат — см. ADR 2026-08-24 про инцидент, из-за которого контур
 * молчал 4 дня незамеченным.
 */
export async function GET() {
  try {
    const health = await notificationsHealth();
    if (!health.checks.ownerDecisions.ok) {
      void log.critical(
        EVENT_SOURCES.OWNER_DECISIONS,
        `Контур решений владельца молчит ${health.checks.ownerDecisions.staleMin} мин — секрет не задан или сайт недоступен для свипера`,
        { ...health.checks.ownerDecisions }
      );
    }
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
