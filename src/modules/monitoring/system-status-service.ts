import os from "node:os";
import { statfs } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";

export type ComponentStatus = "ok" | "warning" | "critical";

export type SystemStatusReport = {
  overall: ComponentStatus;
  summary: string;
  timestamp: string;
  host: {
    hostname: string;
    platform: string;
    uptimeSeconds: number;
  };
  cpu: {
    status: ComponentStatus;
    cores: number;
    loadAvg1m: number;
    loadPerCore: number;
  };
  memory: {
    status: ComponentStatus;
    totalBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  disk: {
    status: ComponentStatus;
    totalBytes: number;
    usedBytes: number;
    usedPercent: number;
    path: string;
  } | null;
  database: {
    status: ComponentStatus;
    latencyMs: number | null;
    error?: string;
  };
  redis: {
    status: ComponentStatus;
    latencyMs: number | null;
    error?: string;
  };
};

// Thresholds: first value — "warning", second — "critical"
const CPU_LOAD_PER_CORE = [0.8, 1.25] as const;
const MEM_USED_PERCENT = [80, 92] as const;
const DISK_USED_PERCENT = [80, 92] as const;
const DB_LATENCY_MS = [200, 1000] as const;
const REDIS_LATENCY_MS = [50, 300] as const;

function gradeByThreshold(
  value: number,
  [warn, crit]: readonly [number, number]
): ComponentStatus {
  if (value >= crit) return "critical";
  if (value >= warn) return "warning";
  return "ok";
}

function worst(statuses: ComponentStatus[]): ComponentStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("warning")) return "warning";
  return "ok";
}

async function checkDatabase(): Promise<SystemStatusReport["database"]> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Date.now() - start;
    return { status: gradeByThreshold(latencyMs, DB_LATENCY_MS), latencyMs };
  } catch (error) {
    return {
      status: "critical",
      latencyMs: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function checkRedis(): Promise<SystemStatusReport["redis"]> {
  if (!redisAvailable) {
    return { status: "critical", latencyMs: null, error: "Redis not connected" };
  }
  const start = Date.now();
  try {
    await redis.ping();
    const latencyMs = Date.now() - start;
    return { status: gradeByThreshold(latencyMs, REDIS_LATENCY_MS), latencyMs };
  } catch (error) {
    return {
      status: "critical",
      latencyMs: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function collectCpu(): SystemStatusReport["cpu"] {
  const cores = os.cpus().length || 1;
  const loadAvg1m = os.loadavg()[0] ?? 0;
  const loadPerCore = loadAvg1m / cores;
  return {
    status: gradeByThreshold(loadPerCore, CPU_LOAD_PER_CORE),
    cores,
    loadAvg1m,
    loadPerCore,
  };
}

function collectMemory(): SystemStatusReport["memory"] {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  return {
    status: gradeByThreshold(usedPercent, MEM_USED_PERCENT),
    totalBytes,
    usedBytes,
    usedPercent,
  };
}

async function collectDisk(path = "/"): Promise<SystemStatusReport["disk"]> {
  try {
    const stats = await statfs(path);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
    return {
      status: gradeByThreshold(usedPercent, DISK_USED_PERCENT),
      totalBytes,
      usedBytes,
      usedPercent,
      path,
    };
  } catch {
    return null;
  }
}

function buildSummary(report: Omit<SystemStatusReport, "overall" | "summary">): {
  overall: ComponentStatus;
  summary: string;
} {
  const componentStatuses: ComponentStatus[] = [
    report.cpu.status,
    report.memory.status,
    report.database.status,
    report.redis.status,
  ];
  if (report.disk) componentStatuses.push(report.disk.status);

  const overall = worst(componentStatuses);

  if (overall === "ok") {
    return { overall, summary: "Все системы работают штатно" };
  }

  const problems: string[] = [];
  if (report.database.status !== "ok") problems.push("база данных");
  if (report.redis.status !== "ok") problems.push("Redis");
  if (report.cpu.status !== "ok") problems.push("CPU");
  if (report.memory.status !== "ok") problems.push("память");
  if (report.disk && report.disk.status !== "ok") problems.push("диск");

  const prefix = overall === "critical" ? "Критично" : "Требует внимания";
  return { overall, summary: `${prefix}: ${problems.join(", ")}` };
}

export async function getSystemStatus(): Promise<SystemStatusReport> {
  const [database, redisCheck, disk] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    collectDisk(process.env.SERVER_STATUS_DISK_PATH ?? "/"),
  ]);
  const cpu = collectCpu();
  const memory = collectMemory();

  const base = {
    timestamp: new Date().toISOString(),
    host: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      uptimeSeconds: Math.floor(os.uptime()),
    },
    cpu,
    memory,
    disk,
    database,
    redis: redisCheck,
  };

  const { overall, summary } = buildSummary(base);
  return { ...base, overall, summary };
}
