import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: { productEvent: { create: vi.fn() } } }));
import { prisma } from "@/lib/db";
import {
  dashboardEventSchema,
  recordDashboardEvent,
} from "../dashboard-events";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", "local-test-secret");
});
afterEach(() => vi.unstubAllEnvs());
describe("dashboard telemetry", () => {
  it("rejects client success events and arbitrary PII", () => {
    expect(
      dashboardEventSchema.safeParse({ event: "contact_link_succeeded" })
        .success,
    ).toBe(false);
    expect(
      dashboardEventSchema.safeParse({
        event: "dashboard_view",
        url: "/dashboard?attachEmail=secret",
      }).success,
    ).toBe(false);
    expect(
      dashboardEventSchema.safeParse({
        event: "contact_link_started",
        channel: "email",
        userId: "victim",
      }).success,
    ).toBe(false);
  });
  it("stores a stable server-derived account pseudonym separately from purchase funnels", async () => {
    await recordDashboardEvent("private-user-id", "contact_link_succeeded", {
      channel: "email",
    });
    const data = vi.mocked(prisma.productEvent.create).mock.calls[0][0].data;
    expect(data).toMatchObject({
      funnel: "dashboard",
      moduleSlug: "profile",
      step: "contact_link_succeeded",
      metadata: { channel: "email" },
    });
    expect(data.sessionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(data)).not.toContain("private-user-id");
    await recordDashboardEvent("private-user-id", "dashboard_view");
    expect(
      vi.mocked(prisma.productEvent.create).mock.calls[1][0].data.sessionKey,
    ).toBe(data.sessionKey);
  });
  it("does not throw when telemetry is unavailable", async () => {
    vi.mocked(prisma.productEvent.create).mockRejectedValue(
      new Error("database unavailable"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      recordDashboardEvent("owner", "dashboard_view"),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

it("aggregates by Moscow calendar boundaries without returning individual account keys", async () => {
  const { getDashboardEventStats } = await import("../dashboard-events");
  const { prisma: db } = await import("@/lib/db");
  Object.assign(db, {
    $queryRaw: vi
      .fn()
      .mockResolvedValue([
        { event: "dashboard_view", events: BigInt(7), accounts: BigInt(3) },
      ]),
  });
  expect(
    await getDashboardEventStats("2026-01-01", "2026-01-07"),
  ).toMatchObject({
    timezone: "Europe/Moscow",
    rows: [{ event: "dashboard_view", events: 7, accounts: 3 }],
  });
  expect(db.$queryRaw).toHaveBeenCalledWith(
    expect.any(Array),
    new Date("2025-12-31T21:00:00Z"),
    new Date("2026-01-07T21:00:00Z"),
  );
});
