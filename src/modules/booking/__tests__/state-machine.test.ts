import { describe, it, expect } from "vitest";
import { assertValidTransition, getAllowedTransitions, BookingTransitionError } from "../state-machine";
import type { TransitionContext } from "../state-machine";

const futureStart = new Date("2030-08-20T12:00:00");
const pastStart = new Date("2020-01-01T10:00:00");

function makeCtx(overrides: Partial<TransitionContext>): TransitionContext {
  return {
    currentStatus: "PENDING",
    targetStatus: "CONFIRMED",
    actorRole: "MANAGER",
    now: new Date("2030-08-20T09:00:00"),
    startTime: futureStart,
    noShowThresholdMinutes: 30,
    ...overrides,
  };
}

describe("assertValidTransition", () => {
  // --- Valid transitions ---

  it("PENDING → CONFIRMED (MANAGER)", () => {
    expect(() => assertValidTransition(makeCtx({}))).not.toThrow();
  });

  it("PENDING → CANCELLED (CLIENT)", () => {
    expect(() =>
      assertValidTransition(makeCtx({ targetStatus: "CANCELLED", actorRole: "CLIENT" }))
    ).not.toThrow();
  });

  it("CONFIRMED → CANCELLED (CLIENT)", () => {
    expect(() =>
      assertValidTransition(
        makeCtx({ currentStatus: "CONFIRMED", targetStatus: "CANCELLED", actorRole: "CLIENT" })
      )
    ).not.toThrow();
  });

  it("CONFIRMED → CHECKED_IN (MANAGER) when now >= startTime", () => {
    expect(() =>
      assertValidTransition(
        makeCtx({
          currentStatus: "CONFIRMED",
          targetStatus: "CHECKED_IN",
          actorRole: "MANAGER",
          now: new Date("2030-08-20T12:00:00"), // exactly at startTime
          startTime: futureStart,
        })
      )
    ).not.toThrow();
  });

  it("CONFIRMED → NO_SHOW (MANAGER) when 30+ min past startTime", () => {
    expect(() =>
      assertValidTransition(
        makeCtx({
          currentStatus: "CONFIRMED",
          targetStatus: "NO_SHOW",
          actorRole: "MANAGER",
          now: new Date("2030-08-20T12:31:00"), // 31 min after startTime
          startTime: futureStart,
          noShowThresholdMinutes: 30,
        })
      )
    ).not.toThrow();
  });

  it("CONFIRMED → NO_SHOW (CRON) auto", () => {
    expect(() =>
      assertValidTransition(
        makeCtx({
          currentStatus: "CONFIRMED",
          targetStatus: "NO_SHOW",
          actorRole: "CRON",
          now: new Date("2030-08-20T12:31:00"),
          startTime: futureStart,
        })
      )
    ).not.toThrow();
  });

  it("CHECKED_IN → COMPLETED (MANAGER)", () => {
    expect(() =>
      assertValidTransition(
        makeCtx({ currentStatus: "CHECKED_IN", targetStatus: "COMPLETED", actorRole: "MANAGER" })
      )
    ).not.toThrow();
  });

  it("NO_SHOW → CHECKED_IN (MANAGER) — late arrival override", () => {
    expect(() =>
      assertValidTransition(
        makeCtx({ currentStatus: "NO_SHOW", targetStatus: "CHECKED_IN", actorRole: "MANAGER" })
      )
    ).not.toThrow();
  });

  it("NO_SHOW → CANCELLED (SUPERADMIN)", () => {
    expect(() =>
      assertValidTransition(
        makeCtx({ currentStatus: "NO_SHOW", targetStatus: "CANCELLED", actorRole: "SUPERADMIN" })
      )
    ).not.toThrow();
  });

  // --- Invalid transitions ---

  it("CANCELLED → CONFIRMED throws INVALID_STATUS_TRANSITION", () => {
    expect(() =>
      assertValidTransition(makeCtx({ currentStatus: "CANCELLED", targetStatus: "CONFIRMED" }))
    ).toThrow(BookingTransitionError);
  });

  it("COMPLETED → CANCELLED throws INVALID_STATUS_TRANSITION", () => {
    expect(() =>
      assertValidTransition(makeCtx({ currentStatus: "COMPLETED", targetStatus: "CANCELLED" }))
    ).toThrow(BookingTransitionError);
  });

  it("PENDING → CHECKED_IN throws (no such transition)", () => {
    expect(() =>
      assertValidTransition(makeCtx({ currentStatus: "PENDING", targetStatus: "CHECKED_IN" }))
    ).toThrow(BookingTransitionError);
  });

  // --- Role-based rejections ---

  it("CLIENT cannot confirm booking (PENDING → CONFIRMED)", () => {
    const err = (() => {
      try {
        assertValidTransition(makeCtx({ actorRole: "CLIENT" }));
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(BookingTransitionError);
    expect((err as BookingTransitionError).code).toBe("FORBIDDEN");
  });

  it("CLIENT cannot check in (CONFIRMED → CHECKED_IN)", () => {
    expect(() =>
      assertValidTransition(
        makeCtx({
          currentStatus: "CONFIRMED",
          targetStatus: "CHECKED_IN",
          actorRole: "CLIENT",
          now: new Date("2030-08-20T12:10:00"),
          startTime: futureStart,
        })
      )
    ).toThrow(BookingTransitionError);
  });

  // --- Condition violations ---

  it("CONFIRMED → CHECKED_IN throws when now < startTime", () => {
    const err = (() => {
      try {
        assertValidTransition(
          makeCtx({
            currentStatus: "CONFIRMED",
            targetStatus: "CHECKED_IN",
            actorRole: "MANAGER",
            now: new Date("2030-08-20T11:59:00"), // 1 min before startTime
            startTime: futureStart,
          })
        );
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(BookingTransitionError);
    expect((err as BookingTransitionError).code).toBe("TRANSITION_CONDITION_NOT_MET");
  });

  it("CONFIRMED → NO_SHOW throws when < 30 min past startTime", () => {
    const err = (() => {
      try {
        assertValidTransition(
          makeCtx({
            currentStatus: "CONFIRMED",
            targetStatus: "NO_SHOW",
            actorRole: "MANAGER",
            now: new Date("2030-08-20T12:29:00"), // 29 min after startTime
            startTime: futureStart,
            noShowThresholdMinutes: 30,
          })
        );
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(BookingTransitionError);
    expect((err as BookingTransitionError).code).toBe("TRANSITION_CONDITION_NOT_MET");
  });
});

describe("getAllowedTransitions", () => {
  it("returns correct transitions for PENDING/MANAGER", () => {
    const result = getAllowedTransitions("PENDING", "MANAGER");
    expect(result).toContain("CONFIRMED");
    expect(result).toContain("CANCELLED");
  });

  it("returns no transitions for COMPLETED/MANAGER", () => {
    const result = getAllowedTransitions("COMPLETED", "MANAGER");
    expect(result).toHaveLength(0);
  });

  it("CLIENT from PENDING can only cancel", () => {
    const result = getAllowedTransitions("PENDING", "CLIENT");
    expect(result).toEqual(["CANCELLED"]);
  });
});
