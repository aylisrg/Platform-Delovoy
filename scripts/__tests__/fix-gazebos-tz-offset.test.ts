import { describe, it, expect, vi } from "vitest";
import { formatTime } from "../../src/lib/format";

// Keep the test hermetic — the script instantiates the Prisma singleton at
// import time. Both specifiers resolve to the same src/lib/db module, so this
// intercepts the script's `../src/lib/db` import.
vi.mock("../../src/lib/db", () => ({ prisma: {}, notDeleted: {} }));

import { shiftTimes } from "../fix-gazebos-tz-offset";

describe("fix-gazebos-tz-offset · shiftTimes", () => {
  it("subtracts exactly N hours from both endpoints", () => {
    const start = new Date("2026-07-25T15:00:00.000Z");
    const end = new Date("2026-07-25T19:00:00.000Z");
    const out = shiftTimes(start, end, 3);
    expect(out.startTime.toISOString()).toBe("2026-07-25T12:00:00.000Z");
    expect(out.endTime.toISOString()).toBe("2026-07-25T16:00:00.000Z");
  });

  it("restores the guest-selected Moscow time for a +3h-drifted booking", () => {
    // Old buggy code stored a guest's 15:00–19:00 MSK pick as 15:00Z–19:00Z.
    // After the -3h correction, formatTime (Europe/Moscow) must render the
    // original 15:00–19:00 the guest actually chose.
    const drifted = {
      startTime: new Date("2026-07-25T15:00:00.000Z"),
      endTime: new Date("2026-07-25T19:00:00.000Z"),
    };
    const fixed = shiftTimes(drifted.startTime, drifted.endTime, 3);
    expect(formatTime(fixed.startTime)).toBe("15:00");
    expect(formatTime(fixed.endTime)).toBe("19:00");
  });

  it("does not mutate the input Date objects", () => {
    const start = new Date("2026-07-25T15:00:00.000Z");
    const end = new Date("2026-07-25T19:00:00.000Z");
    shiftTimes(start, end, 3);
    expect(start.toISOString()).toBe("2026-07-25T15:00:00.000Z");
    expect(end.toISOString()).toBe("2026-07-25T19:00:00.000Z");
  });

  it("honours a custom shift amount", () => {
    const start = new Date("2026-07-25T10:00:00.000Z");
    const end = new Date("2026-07-25T12:00:00.000Z");
    const out = shiftTimes(start, end, 2);
    expect(out.startTime.toISOString()).toBe("2026-07-25T08:00:00.000Z");
    expect(out.endTime.toISOString()).toBe("2026-07-25T10:00:00.000Z");
  });
});
