import { describe, it, expect } from "vitest";
import { isSnapshotStale, periodRange } from "../items";

describe("periodRange", () => {
  it("7d returns 7-day window ending today", () => {
    const now = new Date("2026-04-28T12:00:00Z");
    const { dateFrom, dateTo } = periodRange("7d", now);
    expect(dateTo.getUTCFullYear()).toBe(2026);
    expect(dateTo.getUTCMonth()).toBe(3); // April
    expect(dateTo.getUTCDate()).toBe(28);
    // 7 days back inclusive — Apr 22.
    expect(dateFrom.getUTCDate()).toBe(22);
    expect(dateFrom.getUTCHours()).toBe(0);
    expect(dateTo.getUTCHours()).toBe(23);
  });

  it("30d returns 30-day window", () => {
    const now = new Date("2026-04-28T00:00:00Z");
    const { dateFrom, dateTo } = periodRange("30d", now);
    const diffDays = Math.round((dateTo.getTime() - dateFrom.getTime()) / 86_400_000);
    expect(diffDays).toBe(30); // ~29 days 23:59:59.999 → rounds to 30
  });
});

describe("isSnapshotStale", () => {
  it("null is stale", () => {
    expect(isSnapshotStale(null)).toBe(true);
  });

  it("very recent is fresh", () => {
    expect(isSnapshotStale(new Date(Date.now() - 60_000))).toBe(false);
  });

  it("older than 30 minutes is stale", () => {
    expect(isSnapshotStale(new Date(Date.now() - 31 * 60_000))).toBe(true);
  });
});
