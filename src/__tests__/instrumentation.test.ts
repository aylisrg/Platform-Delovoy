import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { register } from "../instrumentation";

type GuardGlobal = { __delovoyProcessGuards?: boolean };

const addedListeners: Array<{ event: string; fn: (...args: never[]) => void }> = [];

function snapshotListeners(event: string) {
  return process.listeners(event as "unhandledRejection").slice();
}

beforeEach(() => {
  delete (globalThis as GuardGlobal).__delovoyProcessGuards;
});

afterEach(() => {
  for (const { event, fn } of addedListeners) {
    process.removeListener(event as "unhandledRejection", fn as never);
  }
  addedListeners.length = 0;
  delete (globalThis as GuardGlobal).__delovoyProcessGuards;
  vi.unstubAllEnvs();
});

async function registerAndTrack() {
  const beforeRejection = snapshotListeners("unhandledRejection");
  const beforeMonitor = snapshotListeners("uncaughtExceptionMonitor");
  await register();
  for (const fn of snapshotListeners("unhandledRejection")) {
    if (!beforeRejection.includes(fn)) addedListeners.push({ event: "unhandledRejection", fn });
  }
  for (const fn of snapshotListeners("uncaughtExceptionMonitor")) {
    if (!beforeMonitor.includes(fn)) addedListeners.push({ event: "uncaughtExceptionMonitor", fn });
  }
}

describe("instrumentation.register", () => {
  it("ставит process-гарды в nodejs-рантайме", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const rejectionBefore = process.listenerCount("unhandledRejection");
    const monitorBefore = process.listenerCount("uncaughtExceptionMonitor");

    await registerAndTrack();

    expect(process.listenerCount("unhandledRejection")).toBe(rejectionBefore + 1);
    expect(process.listenerCount("uncaughtExceptionMonitor")).toBe(monitorBefore + 1);
  });

  it("повторный вызов не плодит хендлеры", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await registerAndTrack();
    const rejectionAfterFirst = process.listenerCount("unhandledRejection");

    await register();

    expect(process.listenerCount("unhandledRejection")).toBe(rejectionAfterFirst);
  });

  it("ничего не делает вне nodejs-рантайма (edge)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const before = process.listenerCount("unhandledRejection");

    await register();

    expect(process.listenerCount("unhandledRejection")).toBe(before);
  });
});
