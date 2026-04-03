/**
 * External health check script.
 *
 * Pings /api/health and sends Telegram alerts on failures.
 * Can be run via cron every 30 seconds.
 *
 * Usage: npx tsx scripts/health-check.ts [url]
 * Default URL: http://localhost:3000
 */

import { sendAlert } from "../bot/index";

const APP_URL = process.argv[2] || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const HEALTH_URL = `${APP_URL}/api/health`;

let consecutiveFailures = 0;

async function checkHealth() {
  try {
    const response = await fetch(HEALTH_URL, {
      signal: AbortSignal.timeout(10000),
    });

    const data = await response.json();

    if (data.status === "healthy") {
      if (consecutiveFailures > 0) {
        console.log(`[Health] Recovered after ${consecutiveFailures} failures`);
        await sendAlert("INFO", "health-check", `System recovered after ${consecutiveFailures} failures`);
        consecutiveFailures = 0;
      }
      console.log(`[Health] OK — ${JSON.stringify(data.checks)}`);
      return;
    }

    consecutiveFailures++;
    console.warn(`[Health] Degraded/Unhealthy — ${JSON.stringify(data)}`);

    if (consecutiveFailures >= 2) {
      await sendAlert(
        "CRITICAL",
        "health-check",
        `System ${data.status} — ${consecutiveFailures} consecutive failures`,
        JSON.stringify(data.checks, null, 2)
      );
    }
  } catch (error) {
    consecutiveFailures++;
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Health] Unreachable — ${message}`);

    if (consecutiveFailures >= 2) {
      await sendAlert(
        "CRITICAL",
        "health-check",
        `Cannot reach ${HEALTH_URL} — ${consecutiveFailures} consecutive failures`,
        message
      );
    }
  }
}

// Run once
checkHealth().then(() => process.exit(0));
