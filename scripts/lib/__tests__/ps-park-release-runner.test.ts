import { describe, expect, it, vi } from "vitest";
import { runPSParkRelease } from "../ps-park-release-runner";

function actions(alreadyApplied = false, onlineBookingEnabled = true) {
  return {
    verify: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    activate: vi.fn().mockResolvedValue({ onlineBookingEnabled, changed: !alreadyApplied, alreadyApplied }),
    rollback: vi.fn().mockResolvedValue({ onlineBookingEnabled: false, changed: true }),
  };
}
describe("Play Park release orchestration", () => {
  it("verifies before activation and checks the actual new checkout afterwards", async () => {
    const steps = actions();
    await expect(runPSParkRelease(steps)).resolves.toMatchObject({ onlineBookingEnabled: true, changed: true });
    expect(steps.verify.mock.invocationCallOrder[0]).toBeLessThan(steps.activate.mock.invocationCallOrder[0]);
    expect(steps.verify).toHaveBeenNthCalledWith(2, true, true);
    expect(steps.rollback).not.toHaveBeenCalled();
  });
  it("never activates if preflight fails", async () => {
    const steps = actions();
    steps.verify.mockRejectedValueOnce(new Error("LIVE_DEPENDENCIES_UNHEALTHY"));
    await expect(runPSParkRelease(steps)).rejects.toThrow("LIVE_DEPENDENCIES_UNHEALTHY");
    expect(steps.activate).not.toHaveBeenCalled();
    expect(steps.rollback).not.toHaveBeenCalled();
  });
  it("rolls back our first activation if post-check fails", async () => {
    const steps = actions();
    steps.verify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("LIVE_CHECKOUT_STATE_MISMATCH"));
    await expect(runPSParkRelease(steps)).rejects.toThrow("LIVE_CHECKOUT_STATE_MISMATCH");
    expect(steps.rollback).toHaveBeenCalledOnce();
  });
  it("preserves a later manual OFF and does not require the old offer", async () => {
    const steps = actions(true, false);
    await expect(runPSParkRelease(steps)).resolves.toMatchObject({ onlineBookingEnabled: false, alreadyApplied: true });
    expect(steps.verify).toHaveBeenNthCalledWith(2, false, false);
    expect(steps.rollback).not.toHaveBeenCalled();
  });
  it("does not change operator state on a failed check of a previously applied release", async () => {
    const steps = actions(true);
    steps.verify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("HTTP_FAILED"));
    await expect(runPSParkRelease(steps)).rejects.toThrow("HTTP_FAILED");
    expect(steps.rollback).not.toHaveBeenCalled();
  });
});
