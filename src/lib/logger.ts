import { prisma } from "./db";
import type { EventLevel } from "@prisma/client";

/**
 * Log a system event to the database.
 */
export async function logEvent(
  level: EventLevel,
  source: string,
  message: string,
  metadata?: Record<string, unknown>
) {
  try {
    await prisma.systemEvent.create({
      data: {
        level,
        source,
        message,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      },
    });
  } catch (error) {
    // Fallback to console if DB is unavailable
    console.error(`[${level}] [${source}] ${message}`, metadata, error);
  }
}

/**
 * Log an audit trail entry for user actions.
 */
export async function logAudit(
  userId: string,
  action: string,
  entity: string,
  entityId?: string,
  metadata?: Record<string, unknown>
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
      },
    });
  } catch (error) {
    console.error(`[AUDIT] ${action} ${entity} ${entityId}`, metadata, error);
  }
}

// Convenience methods
export const log = {
  info: (source: string, message: string, metadata?: Record<string, unknown>) =>
    logEvent("INFO", source, message, metadata),
  warn: (source: string, message: string, metadata?: Record<string, unknown>) =>
    logEvent("WARNING", source, message, metadata),
  error: (source: string, message: string, metadata?: Record<string, unknown>) =>
    logEvent("ERROR", source, message, metadata),
  critical: (source: string, message: string, metadata?: Record<string, unknown>) =>
    logEvent("CRITICAL", source, message, metadata),
};
