import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    critical: vi.fn(),
  },
  logAudit: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  getServerInfo,
  getServerStats,
  getServerLogs,
  executeServerAction,
  checkTimewebHealth,
  TimewebError,
} from "@/modules/timeweb/service";
import { redis } from "@/lib/redis";
import { log } from "@/lib/logger";

const mockServerResponse = {
  server: {
    id: 7225779,
    name: "delovoy-vps",
    status: "on",
    os: { id: 1, name: "Ubuntu", version: "22.04" },
    networks: [
      {
        type: "public",
        ips: [{ type: "ipv4", ip: "185.1.2.3" }],
      },
    ],
    configurator: { cpu: 2, ram: 4096, disk: 40960 },
    preset: null,
    location: "ru-1",
    created_at: "2025-01-15T10:00:00Z",
  },
};

const mockStatsResponse = {
  response_id: "abc123",
  server_statistics: [
    {
      cpu: [
        { timestamp: "2025-06-01T12:00:00Z", value: 25.5 },
        { timestamp: "2025-06-01T12:05:00Z", value: 30.0 },
      ],
      ram: [
        { timestamp: "2025-06-01T12:00:00Z", value: 60.0 },
        { timestamp: "2025-06-01T12:05:00Z", value: 62.5 },
      ],
      disk: [
        { timestamp: "2025-06-01T12:00:00Z", value: 45.0 },
        { timestamp: "2025-06-01T12:05:00Z", value: 45.1 },
      ],
      network_traffic: [
        {
          timestamp: "2025-06-01T12:00:00Z",
          value: { incoming: 1024, outgoing: 512 },
        },
        {
          timestamp: "2025-06-01T12:05:00Z",
          value: { incoming: 2048, outgoing: 1024 },
        },
      ],
    },
  ],
};

const mockLogsResponse = {
  server_logs: [
    { logged_at: "2025-06-01T12:00:00Z", event: "Server started" },
    { logged_at: "2025-06-01T11:55:00Z", event: "Server stopped" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TIMEWEB_API_TOKEN = "test-token-123";
  process.env.TIMEWEB_SERVER_ID = "7225779";
  vi.mocked(redis.get).mockResolvedValue(null);
  vi.mocked(redis.set).mockResolvedValue("OK");
  vi.mocked(redis.del).mockResolvedValue(1);
});

// ─── getServerInfo ──────────────────────────────────────────────────────────

describe("getServerInfo", () => {
  it("fetches and transforms server info", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockServerResponse),
    });

    const info = await getServerInfo();

    expect(info.id).toBe(7225779);
    expect(info.name).toBe("delovoy-vps");
    expect(info.status).toBe("on");
    expect(info.ip).toBe("185.1.2.3");
    expect(info.os.name).toBe("Ubuntu");
    expect(info.configuration.cpu).toBe(2);
    expect(info.configuration.ram).toBe(4096);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.timeweb.cloud/api/v1/servers/7225779",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token-123",
        }),
      })
    );
  });

  it("returns cached data when available", async () => {
    const cached = {
      id: 7225779,
      name: "delovoy-vps",
      status: "on",
      os: { id: 1, name: "Ubuntu", version: "22.04" },
      ip: "185.1.2.3",
      configuration: { cpu: 2, ram: 4096, disk: 40960 },
      location: "ru-1",
      createdAt: "2025-01-15T10:00:00Z",
    };
    vi.mocked(redis.get).mockResolvedValueOnce(JSON.stringify(cached));

    const info = await getServerInfo();

    expect(info.id).toBe(7225779);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("caches fetched data in Redis", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockServerResponse),
    });

    await getServerInfo();

    expect(redis.set).toHaveBeenCalledWith(
      "timeweb:server:7225779:info",
      expect.any(String),
      "EX",
      30
    );
  });

  it("throws TimewebError on API failure", async () => {
    const errorResponse = {
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: () => Promise.resolve("Invalid token"),
    };
    mockFetch.mockResolvedValueOnce(errorResponse);

    await expect(getServerInfo()).rejects.toThrow(TimewebError);

    mockFetch.mockResolvedValueOnce(errorResponse);

    await expect(getServerInfo()).rejects.toMatchObject({
      code: "TIMEWEB_UNAUTHORIZED",
    });
  });

  it("throws TimewebError when token is missing", async () => {
    delete process.env.TIMEWEB_API_TOKEN;

    await expect(getServerInfo()).rejects.toThrow(TimewebError);
    await expect(getServerInfo()).rejects.toMatchObject({
      code: "CONFIG_MISSING",
    });
  });

  it("extracts IP from networks", async () => {
    const noIpServer = {
      server: { ...mockServerResponse.server, networks: [] },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(noIpServer),
    });

    const info = await getServerInfo();
    expect(info.ip).toBeNull();
  });
});

// ─── getServerStats ─────────────────────────────────────────────────────────

describe("getServerStats", () => {
  it("fetches and transforms stats", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockStatsResponse),
    });

    const stats = await getServerStats();

    expect(stats.serverId).toBe(7225779);
    expect(stats.data).toHaveLength(2);
    expect(stats.data[0].cpuPercent).toBe(25.5);
    expect(stats.data[0].ramPercent).toBe(60.0);
    expect(stats.data[0].diskPercent).toBe(45.0);
    expect(stats.data[0].networkInBytes).toBe(1024);
  });

  it("passes date_from and date_to as query params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockStatsResponse),
    });

    await getServerStats({ dateFrom: "2025-01-01", dateTo: "2025-01-31" });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("date_from=2025-01-01"),
      expect.any(Object)
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("date_to=2025-01-31"),
      expect.any(Object)
    );
  });

  it("handles empty statistics gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ response_id: "x", server_statistics: [{}] }),
    });

    const stats = await getServerStats();
    expect(stats.data).toHaveLength(0);
  });
});

// ─── getServerLogs ──────────────────────────────────────────────────────────

describe("getServerLogs", () => {
  it("fetches and transforms logs", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockLogsResponse),
    });

    const logs = await getServerLogs({ limit: 50, order: "desc" });

    expect(logs.serverId).toBe(7225779);
    expect(logs.logs).toHaveLength(2);
    expect(logs.logs[0].message).toBe("Server started");
    expect(logs.logs[0].timestamp).toBe("2025-06-01T12:00:00Z");
  });

  it("passes query params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockLogsResponse),
    });

    await getServerLogs({ limit: 25, order: "asc" });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("limit=25"),
      expect.any(Object)
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("order=asc"),
      expect.any(Object)
    );
  });
});

// ─── executeServerAction ────────────────────────────────────────────────────

describe("executeServerAction", () => {
  it("sends POST for reboot", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await executeServerAction("reboot");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.timeweb.cloud/api/v1/servers/7225779/reboot",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("invalidates cache after action", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await executeServerAction("start");

    expect(redis.del).toHaveBeenCalledWith("timeweb:server:7225779:info");
  });

  it("logs the action", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await executeServerAction("shutdown");

    expect(log.info).toHaveBeenCalledWith(
      "timeweb",
      "Server shutdown initiated",
      expect.objectContaining({ action: "shutdown" })
    );
  });

  it("throws on API error", async () => {
    const errorResponse = {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: () => Promise.resolve("Rate limit exceeded"),
    };
    mockFetch.mockResolvedValueOnce(errorResponse);

    await expect(executeServerAction("reboot")).rejects.toThrow(TimewebError);

    mockFetch.mockResolvedValueOnce(errorResponse);

    await expect(
      executeServerAction("hard-reboot")
    ).rejects.toMatchObject({ code: "TIMEWEB_RATE_LIMITED" });
  });
});

// ─── checkTimewebHealth ─────────────────────────────────────────────────────

describe("checkTimewebHealth", () => {
  it("returns healthy when server is on", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockServerResponse),
    });

    const health = await checkTimewebHealth();
    expect(health.status).toBe("healthy");
    expect(health.serverStatus).toBe("on");
  });

  it("returns unhealthy when server is off", async () => {
    const offServer = {
      server: { ...mockServerResponse.server, status: "off" },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(offServer),
    });

    const health = await checkTimewebHealth();
    expect(health.status).toBe("unhealthy");
    expect(health.serverStatus).toBe("off");
  });

  it("returns unhealthy with error on fetch failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const health = await checkTimewebHealth();
    expect(health.status).toBe("unhealthy");
    expect(health.error).toContain("Network error");
  });
});
