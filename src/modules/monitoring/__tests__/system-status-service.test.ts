import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  redisAvailable: true,
  redis: {
    ping: vi.fn(),
  },
}));

vi.mock("node:os", () => ({
  default: {
    cpus: vi.fn(),
    loadavg: vi.fn(),
    totalmem: vi.fn(),
    freemem: vi.fn(),
    hostname: vi.fn(() => "test-host"),
    type: vi.fn(() => "Linux"),
    release: vi.fn(() => "5.0"),
    uptime: vi.fn(() => 3600),
  },
}));

vi.mock("node:fs/promises", () => ({
  statfs: vi.fn(),
}));

import { getSystemStatus } from "@/modules/monitoring/system-status-service";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import os from "node:os";
import { statfs } from "node:fs/promises";

const FOUR_CORES = [{}, {}, {}, {}];
const GB = 1024 ** 3;

function setHealthyHost() {
  vi.mocked(os.cpus).mockReturnValue(FOUR_CORES as never);
  vi.mocked(os.loadavg).mockReturnValue([0.5, 0.6, 0.7]);
  vi.mocked(os.totalmem).mockReturnValue(8 * GB);
  vi.mocked(os.freemem).mockReturnValue(6 * GB); // 25% used
  vi.mocked(statfs).mockResolvedValue({
    blocks: 1000,
    bsize: 4096,
    bavail: 800,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  setHealthyHost();
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ "?column?": 1 }] as never);
  vi.mocked(redis.ping).mockResolvedValue("PONG" as never);
});

describe("getSystemStatus", () => {
  it("returns overall=ok when every component is healthy", async () => {
    const report = await getSystemStatus();

    expect(report.overall).toBe("ok");
    expect(report.summary).toBe("Все системы работают штатно");
    expect(report.cpu.status).toBe("ok");
    expect(report.memory.status).toBe("ok");
    expect(report.disk?.status).toBe("ok");
    expect(report.database.status).toBe("ok");
    expect(report.redis.status).toBe("ok");
  });

  it("reports host info (hostname, uptime)", async () => {
    const report = await getSystemStatus();
    expect(report.host.hostname).toBe("test-host");
    expect(report.host.uptimeSeconds).toBe(3600);
    expect(report.timestamp).toBeTruthy();
  });

  it("computes CPU load per core correctly", async () => {
    vi.mocked(os.loadavg).mockReturnValue([2.0, 0, 0]); // 2 / 4 cores = 0.5
    const report = await getSystemStatus();
    expect(report.cpu.loadPerCore).toBe(0.5);
    expect(report.cpu.cores).toBe(4);
  });

  it("marks CPU as warning when load per core crosses warn threshold", async () => {
    vi.mocked(os.loadavg).mockReturnValue([3.6, 0, 0]); // 0.9 per core
    const report = await getSystemStatus();
    expect(report.cpu.status).toBe("warning");
    expect(report.overall).toBe("warning");
  });

  it("marks CPU as critical when load per core exceeds crit threshold", async () => {
    vi.mocked(os.loadavg).mockReturnValue([6, 0, 0]); // 1.5 per core
    const report = await getSystemStatus();
    expect(report.cpu.status).toBe("critical");
    expect(report.overall).toBe("critical");
  });

  it("marks memory as critical when >= 92% used", async () => {
    vi.mocked(os.totalmem).mockReturnValue(10 * GB);
    vi.mocked(os.freemem).mockReturnValue(0.5 * GB); // 95% used
    const report = await getSystemStatus();
    expect(report.memory.status).toBe("critical");
    expect(report.overall).toBe("critical");
    expect(report.summary).toContain("память");
  });

  it("returns disk=null when statfs fails", async () => {
    vi.mocked(statfs).mockRejectedValue(new Error("EACCES"));
    const report = await getSystemStatus();
    expect(report.disk).toBeNull();
    expect(report.overall).toBe("ok");
  });

  it("marks database as critical when prisma throws", async () => {
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("connection refused"));
    const report = await getSystemStatus();
    expect(report.database.status).toBe("critical");
    expect(report.database.error).toBe("connection refused");
    expect(report.overall).toBe("critical");
    expect(report.summary).toContain("база данных");
  });

  it("marks redis as critical when ping fails", async () => {
    vi.mocked(redis.ping).mockRejectedValue(new Error("timeout"));
    const report = await getSystemStatus();
    expect(report.redis.status).toBe("critical");
    expect(report.overall).toBe("critical");
    expect(report.summary).toContain("Redis");
  });

  it("worst status wins: critical overrides warning", async () => {
    // Memory warning (85%) + DB critical
    vi.mocked(os.totalmem).mockReturnValue(10 * GB);
    vi.mocked(os.freemem).mockReturnValue(1.5 * GB); // 85% used
    vi.mocked(prisma.$queryRaw).mockRejectedValue(new Error("down"));
    const report = await getSystemStatus();
    expect(report.memory.status).toBe("warning");
    expect(report.database.status).toBe("critical");
    expect(report.overall).toBe("critical");
  });

  it("reports disk usage percent from statfs", async () => {
    vi.mocked(statfs).mockResolvedValue({
      blocks: 1000,
      bsize: 1024,
      bavail: 100, // 90% used
    } as never);
    const report = await getSystemStatus();
    expect(report.disk?.usedPercent).toBeCloseTo(90, 0);
    expect(report.disk?.status).toBe("warning");
  });
});
