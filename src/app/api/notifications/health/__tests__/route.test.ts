import { describe, it, expect, vi } from "vitest";

vi.mock("@/modules/notifications/health", () => ({
  notificationsHealth: vi.fn(),
}));

import { notificationsHealth } from "@/modules/notifications/health";
import { GET } from "../route";

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
      },
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.ok).toBe(true);
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
});
