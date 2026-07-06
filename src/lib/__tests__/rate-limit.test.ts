import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ available: false }));

const pipelineMock = vi.hoisted(() => ({
  zremrangebyscore: vi.fn(),
  zadd: vi.fn(),
  zcard: vi.fn(),
  expire: vi.fn(),
  exec: vi.fn(),
}));

vi.mock("@/lib/redis", () => ({
  get redisAvailable() {
    return state.available;
  },
  redis: {
    pipeline: vi.fn(() => pipelineMock),
  },
}));

import { rateLimit } from "../rate-limit";

function makeRequest(ip = "1.2.3.4"): NextRequest {
  return {
    headers: new Headers({ "x-forwarded-for": ip }),
  } as unknown as NextRequest;
}

function mockCount(count: number) {
  pipelineMock.exec.mockResolvedValue([
    [null, 1],
    [null, 1],
    [null, count],
    [null, 1],
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rateLimit — Redis доступен", () => {
  beforeEach(() => {
    state.available = true;
  });

  it("пропускает запрос в пределах лимита", async () => {
    mockCount(5);
    const result = await rateLimit(makeRequest(), "public");
    expect(result).toBeNull();
  });

  it("возвращает 429 при превышении лимита", async () => {
    mockCount(61); // public: 60/мин
    const result = await rateLimit(makeRequest(), "public");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("ключует по userId, когда он передан", async () => {
    mockCount(1);
    await rateLimit(makeRequest(), "authenticated", "user-42");
    expect(pipelineMock.zadd).toHaveBeenCalledWith(
      expect.stringContaining("user:user-42"),
      expect.any(Number),
      expect.any(String)
    );
  });

  it("fail-open при ошибке Redis + громкий лог", async () => {
    pipelineMock.exec.mockRejectedValue(new Error("connection reset"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await rateLimit(makeRequest(), "public");

    expect(result).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("ОТКЛЮЧЁН"));
    errSpy.mockRestore();
  });
});

describe("rateLimit — Redis недоступен", () => {
  beforeEach(() => {
    state.available = false;
  });

  it("fail-open без обращения к Redis, лог не чаще раза в минуту", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const first = await rateLimit(makeRequest(), "public");
    const second = await rateLimit(makeRequest(), "public");

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(pipelineMock.exec).not.toHaveBeenCalled();
    // Лог затроттлен: два вызова подряд — максимум одна запись.
    expect(errSpy.mock.calls.length).toBeLessThanOrEqual(1);
    errSpy.mockRestore();
  });
});
