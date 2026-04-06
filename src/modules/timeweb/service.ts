import { redis, redisAvailable } from "@/lib/redis";
import { log } from "@/lib/logger";
import type {
  TimewebServerInfo,
  TimewebServerStats,
  TimewebServerLogs,
  TimewebStatsDataPoint,
  TimewebLogEntry,
  TimewebPowerAction,
  StatsQuery,
  LogsQuery,
} from "./types";

// ─── Error ──────────────────────────────────────────────────────────────────

export class TimewebError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "TimewebError";
  }
}

// ─── Config ─────────────────────────────────────────────────────────────────

const TIMEWEB_BASE_URL = "https://api.timeweb.cloud/api/v1";
const CACHE_TTL_INFO = 30; // seconds
const CACHE_TTL_STATS = 15;

function getConfig() {
  const token = process.env.TIMEWEB_API_TOKEN;
  const serverId = process.env.TIMEWEB_SERVER_ID;
  if (!token) {
    throw new TimewebError("TIMEWEB_API_TOKEN не настроен", "CONFIG_MISSING");
  }
  if (!serverId) {
    throw new TimewebError("TIMEWEB_SERVER_ID не настроен", "CONFIG_MISSING");
  }
  return { token, serverId };
}

// ─── HTTP Client ────────────────────────────────────────────────────────────

async function timewebFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { token } = getConfig();
  const url = `${TIMEWEB_BASE_URL}${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    const statusMap: Record<number, string> = {
      401: "TIMEWEB_UNAUTHORIZED",
      403: "TIMEWEB_FORBIDDEN",
      404: "TIMEWEB_NOT_FOUND",
      429: "TIMEWEB_RATE_LIMITED",
    };
    const code = statusMap[res.status] ?? "TIMEWEB_API_ERROR";
    throw new TimewebError(
      `Timeweb API ${res.status}: ${errorBody || res.statusText}`,
      code
    );
  }

  return res.json() as Promise<T>;
}

// ─── Cache helpers ──────────────────────────────────────────────────────────

async function getCached<T>(key: string): Promise<T | null> {
  if (!redisAvailable) return null;
  try {
    const raw = await redis.get(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // Redis may be unavailable — proceed without cache
  }
  return null;
}

async function setCache(key: string, data: unknown, ttl: number): Promise<void> {
  if (!redisAvailable) return;
  try {
    await redis.set(key, JSON.stringify(data), "EX", ttl);
  } catch {
    // Silent — caching is best-effort
  }
}

// ─── Server Info ────────────────────────────────────────────────────────────

interface TimewebServerRaw {
  server: {
    id: number;
    name: string;
    status: string;
    os: { id: number; name: string; version: string };
    networks: Array<{
      type: string;
      ips: Array<{ type: string; ip: string }>;
    }>;
    configurator: {
      cpu: number;
      ram: number;
      disk: number;
    } | null;
    preset: {
      cpu: number;
      ram: number;
      disk: number;
    } | null;
    location: string;
    created_at: string;
  };
}

export async function getServerInfo(): Promise<TimewebServerInfo> {
  const { serverId } = getConfig();
  const cacheKey = `timeweb:server:${serverId}:info`;

  const cached = await getCached<TimewebServerInfo>(cacheKey);
  if (cached) return cached;

  const raw = await timewebFetch<TimewebServerRaw>(
    `/servers/${serverId}`
  );

  const s = raw.server;
  const cfg = s.configurator ?? s.preset ?? { cpu: 0, ram: 0, disk: 0 };

  // Extract primary IPv4
  let ip: string | null = null;
  for (const net of s.networks ?? []) {
    for (const ipEntry of net.ips ?? []) {
      if (ipEntry.type === "ipv4") {
        ip = ipEntry.ip;
        break;
      }
    }
    if (ip) break;
  }

  const info: TimewebServerInfo = {
    id: s.id,
    name: s.name,
    status: s.status,
    os: s.os,
    ip,
    configuration: {
      cpu: cfg.cpu,
      ram: cfg.ram,
      disk: cfg.disk,
    },
    location: s.location,
    createdAt: s.created_at,
  };

  await setCache(cacheKey, info, CACHE_TTL_INFO);
  return info;
}

// ─── Server Statistics ──────────────────────────────────────────────────────

interface TimewebStatsRaw {
  response_id: string;
  server_statistics: Array<{
    cpu: Array<{ timestamp: string; value: number }>;
    ram: Array<{ timestamp: string; value: number }>;
    disk: Array<{ timestamp: string; value: number }>;
    network_traffic: Array<{
      timestamp: string;
      value: { incoming: number; outgoing: number };
    }>;
  }>;
}

export async function getServerStats(
  query: StatsQuery = {}
): Promise<TimewebServerStats> {
  const { serverId } = getConfig();
  const cacheKey = `timeweb:server:${serverId}:stats:${query.dateFrom ?? ""}:${query.dateTo ?? ""}`;

  const cached = await getCached<TimewebServerStats>(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams();
  if (query.dateFrom) params.set("date_from", query.dateFrom);
  if (query.dateTo) params.set("date_to", query.dateTo);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const raw = await timewebFetch<TimewebStatsRaw>(
    `/servers/${serverId}/statistics${qs}`
  );

  const stats = raw.server_statistics?.[0];
  const data: TimewebStatsDataPoint[] = [];

  if (stats?.cpu) {
    for (let i = 0; i < stats.cpu.length; i++) {
      const ramEntry = stats.ram?.[i];
      const diskEntry = stats.disk?.[i];
      const netEntry = stats.network_traffic?.[i];

      data.push({
        timestamp: stats.cpu[i].timestamp,
        cpuPercent: stats.cpu[i].value,
        ramPercent: ramEntry?.value ?? 0,
        diskPercent: diskEntry?.value ?? 0,
        networkInBytes: netEntry?.value?.incoming ?? 0,
        networkOutBytes: netEntry?.value?.outgoing ?? 0,
      });
    }
  }

  const result: TimewebServerStats = {
    serverId: Number(serverId),
    period: `${query.dateFrom ?? "auto"} — ${query.dateTo ?? "auto"}`,
    data,
  };

  await setCache(cacheKey, result, CACHE_TTL_STATS);
  return result;
}

// ─── Server Logs ────────────────────────────────────────────────────────────

interface TimewebLogsRaw {
  server_logs: Array<{
    logged_at: string;
    event: string;
  }>;
}

export async function getServerLogs(
  query: LogsQuery = {}
): Promise<TimewebServerLogs> {
  const { serverId } = getConfig();

  const params = new URLSearchParams();
  if (query.limit) params.set("limit", String(query.limit));
  if (query.order) params.set("order", query.order);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const raw = await timewebFetch<TimewebLogsRaw>(
    `/servers/${serverId}/logs${qs}`
  );

  const logs: TimewebLogEntry[] = (raw.server_logs ?? []).map((entry) => ({
    timestamp: entry.logged_at,
    message: entry.event,
  }));

  return {
    serverId: Number(serverId),
    logs,
  };
}

// ─── Power Actions ──────────────────────────────────────────────────────────

export async function executeServerAction(
  action: TimewebPowerAction
): Promise<void> {
  const { serverId } = getConfig();

  await timewebFetch(`/servers/${serverId}/${action}`, {
    method: "POST",
  });

  // Invalidate cached info since status will change
  if (redisAvailable) {
    try {
      await redis.del(`timeweb:server:${serverId}:info`);
    } catch {
      // Best effort
    }
  }

  await log.info("timeweb", `Server ${action} initiated`, {
    serverId,
    action,
  });
}

// ─── Health Check ───────────────────────────────────────────────────────────

export async function checkTimewebHealth(): Promise<{
  status: "healthy" | "unhealthy";
  serverStatus?: string;
  error?: string;
}> {
  try {
    const info = await getServerInfo();
    return {
      status: info.status === "on" ? "healthy" : "unhealthy",
      serverStatus: info.status,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
