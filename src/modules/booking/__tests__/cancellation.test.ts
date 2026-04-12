import { describe, it, expect } from "vitest";
import { computeCancellationPenalty } from "../cancellation";
import type { CancellationPolicy } from "../types";

const policy: CancellationPolicy = { thresholdHours: 2, penaltyPercent: 50 };

const hoursFromNow = (hours: number): Date =>
  new Date(Date.now() + hours * 60 * 60 * 1000);

describe("computeCancellationPenalty", () => {
  it("returns no penalty when skipPolicy = true (manager/superadmin)", () => {
    const result = computeCancellationPenalty(
      hoursFromNow(0.5), // 30 min from now — within threshold
      new Date(),
      1000,
      policy,
      true // skipPolicy
    );
    expect(result.penaltyApplied).toBe(false);
  });

  it("returns no penalty when cancelling more than threshold hours before start", () => {
    const result = computeCancellationPenalty(
      hoursFromNow(3), // 3 hours from now (> 2 threshold)
      new Date(),
      1000,
      policy,
      false
    );
    expect(result.penaltyApplied).toBe(false);
  });

  it("returns no penalty when exactly at threshold boundary (2.0h)", () => {
    const result = computeCancellationPenalty(
      hoursFromNow(2.0),
      new Date(),
      1000,
      policy,
      false
    );
    expect(result.penaltyApplied).toBe(false);
  });

  it("returns penalty when cancelling within threshold", () => {
    const result = computeCancellationPenalty(
      hoursFromNow(1), // 1 hour from now (< 2 threshold)
      new Date(),
      1000,
      policy,
      false
    );
    expect(result.penaltyApplied).toBe(true);
    if (result.penaltyApplied) {
      expect(result.penaltyAmount).toBe(500); // 50% of 1000
      expect(result.basePrice).toBe(1000);
    }
  });

  it("returns no penalty when basePrice = 0", () => {
    const result = computeCancellationPenalty(
      hoursFromNow(0.5),
      new Date(),
      0, // zero price
      policy,
      false
    );
    expect(result.penaltyApplied).toBe(false);
  });

  it("calculates correct penalty amount for custom percent", () => {
    const customPolicy: CancellationPolicy = { thresholdHours: 4, penaltyPercent: 25 };
    const result = computeCancellationPenalty(
      hoursFromNow(2),
      new Date(),
      800,
      customPolicy,
      false
    );
    expect(result.penaltyApplied).toBe(true);
    if (result.penaltyApplied) {
      expect(result.penaltyAmount).toBe(200); // 25% of 800
    }
  });

  it("applies penalty when booking is already past start time", () => {
    const result = computeCancellationPenalty(
      hoursFromNow(-1), // 1 hour ago
      new Date(),
      1000,
      policy,
      false
    );
    expect(result.penaltyApplied).toBe(true);
  });
});
