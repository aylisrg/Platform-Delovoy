import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: { error: (...args: unknown[]) => logErrorMock(...args) },
}));

const redisState = { available: true };
const redisSetMock = vi.fn();
vi.mock("@/lib/redis", () => ({
  redis: { set: (...args: unknown[]) => redisSetMock(...args) },
  get redisAvailable() {
    return redisState.available;
  },
}));

import { register, onRequestError } from "../instrumentation";

type GuardGlobal = { __delovoyProcessGuards?: boolean };

const addedListeners: Array<{ event: string; fn: (...args: never[]) => void }> = [];

function snapshotListeners(event: string) {
  return process.listeners(event as "unhandledRejection").slice();
}

beforeEach(() => {
  delete (globalThis as GuardGlobal).__delovoyProcessGuards;
  logErrorMock.mockReset();
  redisSetMock.mockReset();
  redisSetMock.mockResolvedValue("OK");
  redisState.available = true;
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

describe("instrumentation.onRequestError", () => {
  const request = { path: "/api/gazebos/book", method: "POST", headers: {} };
  const context = { routerKind: "App Router", routePath: "/api/gazebos/[id]", routeType: "route" };

  it("пишет SystemEvent с digest/route/method/statusCode и обрезанным стеком", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const err = new Error("Cannot read properties of undefined");
    (err as { digest?: string }).digest = "abc123";
    err.stack = "Error: boom\n" + "  at x (y.ts:1:1)\n".repeat(200); // длиннее 2000 символов

    await onRequestError(err, request, context);

    expect(logErrorMock).toHaveBeenCalledOnce();
    const [source, message, metadata] = logErrorMock.mock.calls[0];
    expect(source).toBe("server-error");
    expect(message).toBe("Cannot read properties of undefined");
    expect(metadata).toMatchObject({
      digest: "abc123",
      route: "/api/gazebos/[id]",
      routeType: "route",
      method: "POST",
      statusCode: 500,
    });
    expect(metadata.stack.length).toBeLessThanOrEqual(2000);
  });

  it("не пишет заголовки запроса в metadata — никаких PII", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const err = new Error("boom");

    await onRequestError(
      err,
      { path: "/x", method: "GET", headers: { cookie: "session=secret", authorization: "Bearer x" } },
      context
    );

    const metadata = logErrorMock.mock.calls[0][2];
    expect(JSON.stringify(metadata)).not.toContain("secret");
    expect(JSON.stringify(metadata)).not.toContain("Bearer");
  });

  it("ошибка без digest — 'no-digest', не падает", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await onRequestError(new Error("no digest here"), request, context);

    expect(logErrorMock.mock.calls[0][2].digest).toBe("no-digest");
  });

  it("не-Error значение (например, throw строки) — тоже обрабатывается", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await onRequestError("just a string throw", request, context);

    expect(logErrorMock).toHaveBeenCalledOnce();
  });

  it("троттлинг: второй вызов с тем же digest в течение минуты не пишет SystemEvent повторно", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    redisSetMock.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);

    const err = new Error("repeat");
    (err as { digest?: string }).digest = "same-digest";

    await onRequestError(err, request, context);
    await onRequestError(err, request, context);

    expect(redisSetMock).toHaveBeenCalledTimes(2);
    expect(redisSetMock).toHaveBeenNthCalledWith(1, "server-error-throttle:same-digest", "1", "EX", 60, "NX");
    expect(logErrorMock).toHaveBeenCalledOnce();
  });

  it("разные digest не троттлят друг друга", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const errA = new Error("a");
    (errA as { digest?: string }).digest = "digest-a";
    const errB = new Error("b");
    (errB as { digest?: string }).digest = "digest-b";

    await onRequestError(errA, request, context);
    await onRequestError(errB, request, context);

    expect(logErrorMock).toHaveBeenCalledTimes(2);
  });

  it("Redis недоступен → пишет без троттлинга (fail-open)", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    redisState.available = false;

    await onRequestError(new Error("no redis"), request, context);
    await onRequestError(new Error("no redis"), request, context);

    expect(redisSetMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledTimes(2);
  });

  it("ошибка Redis не пробрасывается — событие всё равно логируется", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    redisSetMock.mockRejectedValue(new Error("ECONNRESET"));

    await expect(onRequestError(new Error("x"), request, context)).resolves.toBeUndefined();
    expect(logErrorMock).toHaveBeenCalledOnce();
  });

  it("ошибка log.error() не пробрасывается наружу", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    logErrorMock.mockRejectedValue(new Error("db is down"));

    await expect(onRequestError(new Error("x"), request, context)).resolves.toBeUndefined();
  });

  it("ничего не делает вне nodejs-рантайма (edge) — не трогает redis/logger", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");

    await onRequestError(new Error("edge error"), request, context);

    expect(logErrorMock).not.toHaveBeenCalled();
    expect(redisSetMock).not.toHaveBeenCalled();
  });
});
