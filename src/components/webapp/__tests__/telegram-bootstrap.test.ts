import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitForWebApp } from "../telegram-bootstrap";

describe("waitForWebApp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves synchronously when the SDK is already present", () => {
    const webapp = { id: "tg" };
    const onResult = vi.fn();

    waitForWebApp(() => webapp, onResult);

    // No timers needed — resolved immediately on the fast path.
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(webapp);
  });

  it("resolves once the SDK attaches after a few polls", () => {
    const webapp = { id: "tg" };
    let current: typeof webapp | undefined;
    const onResult = vi.fn();

    waitForWebApp(() => current, onResult, { intervalMs: 100, maxAttempts: 30 });
    expect(onResult).not.toHaveBeenCalled();

    // SDK still missing after two polls.
    vi.advanceTimersByTime(200);
    expect(onResult).not.toHaveBeenCalled();

    // SDK attaches, next poll picks it up.
    current = webapp;
    vi.advanceTimersByTime(100);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(webapp);
  });

  it("falls back to null after maxAttempts so the UI does not hang", () => {
    const onResult = vi.fn();

    waitForWebApp(() => undefined, onResult, { intervalMs: 100, maxAttempts: 30 });

    // Just before the budget is exhausted — still waiting.
    vi.advanceTimersByTime(2900);
    expect(onResult).not.toHaveBeenCalled();

    // Final attempt times out → resolve with null (degrade to guest mode).
    vi.advanceTimersByTime(100);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith(null);
  });

  it("stops polling after cancel and never invokes onResult", () => {
    const onResult = vi.fn();

    const cancel = waitForWebApp(() => undefined, onResult, {
      intervalMs: 100,
      maxAttempts: 30,
    });

    vi.advanceTimersByTime(200);
    cancel();
    vi.advanceTimersByTime(5000);

    expect(onResult).not.toHaveBeenCalled();
  });
});
