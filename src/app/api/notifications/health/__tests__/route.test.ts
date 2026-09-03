import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/modules/notifications/health", () => ({
  OWNER_DECISIONS_STALE_MINUTES: 360,
  notificationsHealth: vi.fn(),
  shouldAlertOwnerDecisionsSilence: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() },
}));

import {
  notificationsHealth,
  shouldAlertOwnerDecisionsSilence,
} from "@/modules/notifications/health";
import { log } from "@/lib/logger";
import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(shouldAlertOwnerDecisionsSilence).mockResolvedValue(true);
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

  it("degraded (транспортный флап в пределах серии) → 200 и WARNING со следом, без CRITICAL (issue #708)", async () => {
    vi.mocked(notificationsHealth).mockResolvedValue({
      ok: true,
      degraded: { reason: "Telegram-проба не достучалась по транспорту (серия 1 из 3)", flapStreak: 1, failedProbes: ["adminChat"] },
      checks: {
        botToken: { ok: true, username: "bot" },
        adminChat: { ok: false, reason: "fetch failed (UND_ERR_CONNECT_TIMEOUT)", transportError: true },
        ownerChat: { ok: true },
        queue: { pending: 0, failedLastHour: 0 },
        cron: { lastRunAt: null, staleMin: 9999 },
        ownerDecisions: { ok: true, lastHeartbeatAt: new Date().toISOString(), staleMin: 1 },
      },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.degraded.flapStreak).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(
      "notifications",
      expect.stringContaining("серия 1 из 3"),
      expect.objectContaining({ flapStreak: 1, failedProbes: ["adminChat"] }),
    );
    expect(log.critical).not.toHaveBeenCalled();
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
    expect(vi.mocked(log.critical).mock.calls[0][1]).toContain("ни разу не зафиксирован");
  });

  it("в тексте алерта — порог и время последнего heartbeat, чтобы отличить задержку cron от поломки", async () => {
    vi.mocked(notificationsHealth).mockResolvedValue({
      ok: false,
      checks: {
        botToken: { ok: true, username: "bot" },
        adminChat: { ok: true, title: "group" },
        ownerChat: { ok: true },
        queue: { pending: 0, failedLastHour: 0 },
        cron: { lastRunAt: null, staleMin: 9999 },
        ownerDecisions: {
          ok: false,
          lastHeartbeatAt: "2026-09-03T04:42:18.000Z",
          staleMin: 400,
          reason: "heartbeat старше 360 мин",
        },
      },
    });

    const res = await GET();

    expect(res.status).toBe(503);
    const message = vi.mocked(log.critical).mock.calls[0][1];
    expect(message).toContain("молчит 400 мин");
    expect(message).toContain("порог 360");
    expect(message).toContain("2026-09-03T04:42:18.000Z");
    expect(message).toContain("OWNER_DECISIONS_SECRET");
  });

  it("тот же эпизод молчания уже алертили → 503 отдаём, но CRITICAL не дублируем", async () => {
    vi.mocked(shouldAlertOwnerDecisionsSilence).mockResolvedValue(false);
    vi.mocked(notificationsHealth).mockResolvedValue({
      ok: false,
      checks: {
        botToken: { ok: true, username: "bot" },
        adminChat: { ok: true, title: "group" },
        ownerChat: { ok: true },
        queue: { pending: 0, failedLastHour: 0 },
        cron: { lastRunAt: null, staleMin: 9999 },
        ownerDecisions: {
          ok: false,
          lastHeartbeatAt: "2026-09-03T04:42:18.000Z",
          staleMin: 400,
          reason: "heartbeat старше 360 мин",
        },
      },
    });

    const res = await GET();

    expect(res.status).toBe(503);
    expect(shouldAlertOwnerDecisionsSilence).toHaveBeenCalledTimes(1);
    expect(log.critical).not.toHaveBeenCalled();
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

    expect(shouldAlertOwnerDecisionsSilence).not.toHaveBeenCalled();
    expect(log.critical).not.toHaveBeenCalled();
  });
});
