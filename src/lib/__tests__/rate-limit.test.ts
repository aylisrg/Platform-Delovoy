import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

const logWarnMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({
  log: { warn: logWarnMock, info: vi.fn(), error: vi.fn() },
}));

import { rateLimit } from "../rate-limit";

function makeRequest(ip = "1.2.3.4", headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers({ "x-forwarded-for": ip, ...headers }),
    nextUrl: { pathname: "/api/test" },
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

afterEach(() => {
  delete process.env.RATE_LIMIT_PUBLIC_PER_MIN;
  delete process.env.RATE_LIMIT_AUTH_PER_MIN;
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

  it("61 запрос больше НЕ режется: дефолт public поднят до 180 (CGNAT мобильных сетей)", async () => {
    mockCount(61);
    const result = await rateLimit(makeRequest(), "public");
    expect(result).toBeNull();
  });

  it("возвращает 429 при превышении лимита (public: 180/мин) и пишет семплированную телеметрию", async () => {
    // Телеметрию проверяем в ПЕРВОМ 429-тесте файла: семпл ≤1/мин — модульный
    // троттлинг, второй 429 в этом же прогоне запись уже не создаст.
    mockCount(181);
    const result = await rateLimit(makeRequest(), "public");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);

    expect(logWarnMock).toHaveBeenCalledTimes(1);
    const [source, message, meta] = logWarnMock.mock.calls[0];
    expect(source).toBe("rate-limit");
    expect(message).toContain("429");
    expect(meta).toMatchObject({ tier: "public", path: "/api/test", limit: 180 });
    // Сырой IP не логируем — только хэш субъекта.
    expect(JSON.stringify(meta)).not.toContain("1.2.3.4");
    expect(meta.subjectHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("лимит public переопределяется env RATE_LIMIT_PUBLIC_PER_MIN без деплоя", async () => {
    process.env.RATE_LIMIT_PUBLIC_PER_MIN = "5";
    mockCount(6);
    const result = await rateLimit(makeRequest(), "public");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("кривое значение env игнорируется — работает дефолт", async () => {
    process.env.RATE_LIMIT_PUBLIC_PER_MIN = "not-a-number";
    mockCount(100);
    const result = await rateLimit(makeRequest(), "public");
    expect(result).toBeNull();
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

  it("ключ — доверенный IP: X-Real-IP от nginx, а не спуфабельное начало XFF", async () => {
    mockCount(1);
    await rateLimit(makeRequest("evil-string, 9.9.9.9", { "x-real-ip": "9.9.9.9" }), "public");
    expect(pipelineMock.zadd).toHaveBeenCalledWith(
      expect.stringContaining("ip:9.9.9.9"),
      expect.any(Number),
      expect.any(String)
    );
  });

  it("без X-Real-IP берётся последний hop XFF (добавлен nginx)", async () => {
    mockCount(1);
    await rateLimit(makeRequest("spoofed, 8.8.4.4"), "public");
    expect(pipelineMock.zadd).toHaveBeenCalledWith(
      expect.stringContaining("ip:8.8.4.4"),
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
