import { sendAlert } from "../index";
import type { EventLevel } from "@prisma/client";

/**
 * Routes system events to Telegram based on severity level.
 *
 * CRITICAL → Telegram + console
 * ERROR    → Telegram + console
 * WARNING  → console only
 * INFO     → console only
 */
export async function routeAlert(
  level: EventLevel,
  source: string,
  message: string,
  details?: string
) {
  // Always log to console
  const prefix = `[${level}] [${source}]`;
  if (level === "CRITICAL" || level === "ERROR") {
    console.error(prefix, message, details ?? "");
  } else if (level === "WARNING") {
    console.warn(prefix, message);
  } else {
    console.log(prefix, message);
  }

  // Send to Telegram for ERROR and CRITICAL
  if (level === "CRITICAL" || level === "ERROR") {
    await sendAlert(level, source, message, details);
  }
}
