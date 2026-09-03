import { NextResponse } from "next/server";
import { EVENT_SOURCES } from "@/lib/event-sources";
import { log } from "@/lib/logger";
import {
  OWNER_DECISIONS_STALE_MINUTES,
  notificationsHealth,
  shouldAlertOwnerDecisionsSilence,
} from "@/modules/notifications/health";

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
 * Молчащий контур owner-decisions алертит отдельно — личным сообщением
 * владельцу. Роут опрашивают часто (`site-watchdog.yml` раз в 5 мин, smoke
 * деплоя), а троттлинг `log.critical()` — всего 300 с, поэтому без своей
 * дедупликации каждый опрос во время молчания рождал бы новый CRITICAL
 * (инцидент 2026-09-03: до дюжины сообщений за ночь из-за задержек cron в
 * GitHub). `shouldAlertOwnerDecisionsSilence()` пропускает один алерт на
 * эпизод молчания и напоминание раз в несколько часов, пока он длится —
 * см. ADR 2026-08-24 про инцидент, из-за которого контур молчал 4 дня
 * незамеченным, и docs/incidents/2026-09-03-owner-decisions-false-stale-alerts.md.
 */
export async function GET() {
  try {
    const health = await notificationsHealth();
    if (health.degraded) {
      // Флап терпим, но след оставляем: по этим WARNING видно, как часто рвётся
      // путь VPS → api.telegram.org (issue #708), без инцидента на каждый обрыв.
      void log.warn(EVENT_SOURCES.NOTIFICATIONS, health.degraded.reason, {
        flapStreak: health.degraded.flapStreak,
        failedProbes: health.degraded.failedProbes,
      });
    }
    const ownerDecisions = health.checks.ownerDecisions;
    if (!ownerDecisions.ok && (await shouldAlertOwnerDecisionsSilence(ownerDecisions))) {
      const lastHeartbeat = ownerDecisions.lastHeartbeatAt
        ? `последний heartbeat свипера ${ownerDecisions.lastHeartbeatAt}`
        : "heartbeat свипера ни разу не зафиксирован";
      void log.critical(
        EVENT_SOURCES.OWNER_DECISIONS,
        `Контур решений владельца молчит ${ownerDecisions.staleMin} мин (порог ${OWNER_DECISIONS_STALE_MINUTES}, ${lastHeartbeat}) — ` +
          "свипер issue-queue-merge не доходит до /api/admin/owner-decisions: OWNER_DECISIONS_SECRET не задан, " +
          "сайт недоступен из Actions или workflow не запускается",
        { ...ownerDecisions }
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
