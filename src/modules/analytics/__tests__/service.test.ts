import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveDateRange } from "../service";

vi.mock("@/lib/redis", () => ({
  redis: { get: vi.fn(), setex: vi.fn(), del: vi.fn() },
  redisAvailable: false,
}));

describe("resolveDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
  });

  it("returns custom range when both dates provided", () => {
    const result = resolveDateRange({ dateFrom: "2026-04-01", dateTo: "2026-04-10" });
    expect(result).toEqual({ dateFrom: "2026-04-01", dateTo: "2026-04-10" });
  });

  it("defaults to 7d period", () => {
    const result = resolveDateRange({});
    expect(result.dateTo).toBe("2026-04-15");
    expect(result.dateFrom).toBe("2026-04-09");
  });

  it("resolves today period", () => {
    const result = resolveDateRange({ period: "today" });
    expect(result.dateFrom).toBe("2026-04-15");
    expect(result.dateTo).toBe("2026-04-15");
  });

  it("resolves 30d period", () => {
    const result = resolveDateRange({ period: "30d" });
    expect(result.dateTo).toBe("2026-04-15");
    expect(result.dateFrom).toBe("2026-03-17");
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
