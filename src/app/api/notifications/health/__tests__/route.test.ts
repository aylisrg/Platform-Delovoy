import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/notifications/health", () => ({
  notificationsHealth: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

import { notificationsHealth } from "@/modules/notifications/health";
import { log } from "@/lib/logger";
import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/notifications/health", () => {
  it("returns 200 when health ok=true", async () => {
    vi.mocked(notificationsHealth).mockResolvedValue({
      ok: true,
      checks: {
        botToken: { ok: true, username: "bot" },
        adminChat: { ok: true, title: "group" },
        ownerChat: { ok: true },
        queue: { pending: 0, failedLastHour: 0 },
        cron: { lastRunAt: null, staleMin: 9999 },
        ownerDecisions: { ok: true, lastHeartbeatAt: new Date().toISOString(), staleMin: 1 },
      },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.ok).toBe(true);
    expect(log.critical).not.toHaveBeenCalled();
  });

  it("returns 503 when health ok=false", async () => {
    vi.mocked(notificationsHealth).mockResolvedValue({
      ok: false,
      checks: {
        botToken: { ok: false, reason: "TELEGRAM_BOT_TOKEN not set" },
        adminChat: { ok: false, reason: "bot token missing" },
        ownerChat: { ok: false, reason: "bot token missing" },
        queue: { pending: 0, failedLastHour: 0 },
        cron: { lastRunAt: null, staleMin: 9999 },
        ownerDecisions: { ok: true, lastHeartbeatAt: new Date().toISOString(), staleMin: 1 },
      },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.success).toBe(true);
    expect(body.data.ok).toBe(false);
  });

  it("returns 503 when notificationsHealth throws", async () => {
    vi.mocked(notificationsHealth).mockRejectedValue(new Error("unexpected"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.data.ok).toBe(false);
  });

  it("alerts critical when owner-decisions heartbeat is stale", async () => {
    vi.mocked(notificationsHealth).mockResolvedValue({
      ok: false,
      checks: {
        botToken: { ok: true, username: "bot" },
        adminChat: { ok: true, title: "group" },
        ownerChat: { ok: true },
        queue: { pending: 0, failedLastHour: 0 },
        cron: { lastRunAt: null, staleMin: 9999 },
        ownerDecisions: { ok: false, lastHeartbeatAt: null, staleMin: 9999, reason: "heartbeat ни разу не зафиксирован" },
      },
    });

    await GET();

    expect(log.critical).toHaveBeenCalledTimes(1);
    expect(log.critical).toHaveBeenCalledWith(
      "owner-decisions",
      expect.stringContaining("Контур решений владельца молчит"),
      expect.objectContaining({ ok: false }),
    );
  });

  it("does not alert when owner-decisions heartbeat is fresh", async () => {
    vi.mocked(notificationsHealth).mockResolvedValue({
      ok: true,
      checks: {
        botToken: { ok: true, username: "bot" },
        adminChat: { ok: true, title: "group" },
        ownerChat: { ok: true },
        queue: { pending: 0, failedLastHour: 0 },
        cron: { lastRunAt: null, staleMin: 9999 },
        ownerDecisions: { ok: true, lastHeartbeatAt: new Date().toISOString(), staleMin: 2 },
      },
    });

    await GET();

    expect(log.critical).not.toHaveBeenCalled();
  });
});
