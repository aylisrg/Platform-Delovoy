import type { EventLevel } from "@prisma/client";

export type SystemEventInput = {
  level: EventLevel;
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type HealthCheckResult = {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: Record<string, {
    status: "healthy" | "degraded" | "unhealthy";
    latencyMs?: number;
    error?: string;
  }>;
};

export type EventStats = {
  last24h: number;
  lastHour: number;
  criticalCount: number;
};
