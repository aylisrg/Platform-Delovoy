import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
const mockFindFirst = vi.fn();
const mockQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    productEvent: {
      create: (...args: unknown[]) => mockCreate(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}));

const mockRedisSet = vi.fn();
let mockRedisAvailable = true;
vi.mock("@/lib/redis", () => ({
  redis: { set: (...args: unknown[]) => mockRedisSet(...args) },
  get redisAvailable() {
    return mockRedisAvailable;
  },
}));

vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn() },
}));

import {
  deriveSessionKeyFromHeaders,
  isPrefetchOrBot,
  recordFunnelStepAsync,
  recordPaidStep,
  getFunnelStats,
} from "../product-events";

function headers(map: Record<string, string>): { get(name: string): string | null } {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("PRODUCT_EVENT_SALT", "test-salt");
  mockRedisAvailable = true;
  mockCreate.mockResolvedValue({});
  mockFindFirst.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue("OK");
});

describe("deriveSessionKeyFromHeaders", () => {
  const base = { "x-real-ip": "203.0.113.7", "user-agent": "Mozilla/5.0 (test)" };

  it("стабилен для одинаковых IP+UA в один день", () => {
    const a = deriveSessionKeyFromHeaders(headers(base));
    const b = deriveSessionKeyFromHeaders(headers(base));
    expect(a).toBe(b);
  });

  it("не совпадает при другом IP", () => {
    const a = deriveSessionKeyFromHeaders(headers(base));
    const b = deriveSessionKeyFromHeaders(headers({ ...base, "x-real-ip": "198.51.100.1" }));
    expect(a).not.toBe(b);
  });

  it("не совпадает при другом user-agent", () => {
    const a = deriveSessionKeyFromHeaders(headers(base));
    const b = deriveSessionKeyFromHeaders(headers({ ...base, "user-agent": "другой браузер" }));
    expect(a).not.toBe(b);
  });

  it("чувствителен к PRODUCT_EVENT_SALT — разная соль даёт разный ключ", () => {
    const a = deriveSessionKeyFromHeaders(headers(base));
    vi.stubEnv("PRODUCT_EVENT_SALT", "другая-соль");
    const b = deriveSessionKeyFromHeaders(headers(base));
    expect(a).not.toBe(b);
  });

  it("не содержит сырой IP/UA в открытом виде — это хэш", () => {
    const key = deriveSessionKeyFromHeaders(headers(base));
    expect(key).not.toContain("203.0.113.7");
    expect(key).not.toContain("Mozilla");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("падает на последний hop x-forwarded-for, если x-real-ip нет", () => {
    const a = deriveSessionKeyFromHeaders(
      headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2", "user-agent": "ua" })
    );
    const b = deriveSessionKeyFromHeaders(headers({ "x-real-ip": "2.2.2.2", "user-agent": "ua" }));
    expect(a).toBe(b);
  });

  it("не бросает при полном отсутствии IP-заголовков", () => {
    expect(() => deriveSessionKeyFromHeaders(headers({}))).not.toThrow();
  });
});

describe("isPrefetchOrBot", () => {
  it("true для next-router-prefetch", () => {
    expect(isPrefetchOrBot(headers({ "next-router-prefetch": "1" }))).toBe(true);
  });

  it("true для purpose: prefetch", () => {
    expect(isPrefetchOrBot(headers({ purpose: "prefetch" }))).toBe(true);
  });

  it("true для известного бота в user-agent", () => {
    expect(isPrefetchOrBot(headers({ "user-agent": "Googlebot/2.1" }))).toBe(true);
  });

  it("false для обычного браузера", () => {
    expect(
      isPrefetchOrBot(
        headers({ "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120" })
      )
    ).toBe(false);
  });
});

describe("recordFunnelStepAsync — никогда не бросает (AC-1.6)", () => {
  it("резолвится, даже если prisma.productEvent.create отклоняется", async () => {
    mockCreate.mockRejectedValue(new Error("db down"));
    await expect(
      recordFunnelStepAsync({ funnel: "cafe", step: "submitted", sessionKey: "s1" })
    ).resolves.toBeUndefined();
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("невалидная воронка — ничего не пишет, не бросает", async () => {
    await recordFunnelStepAsync({
      funnel: "not-a-funnel" as never,
      step: "view",
      sessionKey: "s1",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("шаг, которого нет у воронки — ничего не пишет", async () => {
    await recordFunnelStepAsync({ funnel: "rental", step: "paid" as never, sessionKey: "s1" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("дедуп: redis SET NX вернул null (ключ уже есть) — create не вызывается", async () => {
    mockRedisSet.mockResolvedValue(null);
    await recordFunnelStepAsync({ funnel: "gazebos", step: "slot_selected", sessionKey: "s1" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("дедуп: redis SET NX вернул OK — create вызывается", async () => {
    mockRedisSet.mockResolvedValue("OK");
    await recordFunnelStepAsync({ funnel: "gazebos", step: "slot_selected", sessionKey: "s1" });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("дедуп fail-open: ошибка Redis не блокирует запись", async () => {
    mockRedisSet.mockRejectedValue(new Error("redis down"));
    await recordFunnelStepAsync({ funnel: "gazebos", step: "slot_selected", sessionKey: "s1" });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("submitted/paid не дедуплицируются даже с тем же sessionKey — окно 0", async () => {
    await recordFunnelStepAsync({ funnel: "cafe", step: "submitted", sessionKey: "s1" });
    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("sessionKey=null (серверное событие) не запускает дедуп", async () => {
    await recordFunnelStepAsync({ funnel: "gazebos", step: "slot_selected", sessionKey: null });
    expect(mockRedisSet).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("metadata: сохраняет только allowlist-ключи разрешённых типов", async () => {
    await recordFunnelStepAsync({
      funnel: "cafe",
      step: "submitted",
      sessionKey: "s1",
      metadata: { amountRub: 430, itemCount: 3, guestEmail: "leak@example.com", nested: { a: 1 } },
    });
    const arg = mockCreate.mock.calls[0][0] as { data: { metadata: unknown } };
    expect(arg.data.metadata).toEqual({ amountRub: 430, itemCount: 3 });
  });

  it("metadata пустой после фильтрации → undefined, не {}", async () => {
    await recordFunnelStepAsync({
      funnel: "cafe",
      step: "submitted",
      sessionKey: "s1",
      metadata: { guestEmail: "leak@example.com" },
    });
    const arg = mockCreate.mock.calls[0][0] as { data: { metadata: unknown } };
    expect(arg.data.metadata).toBeUndefined();
  });

  it("moduleSlug берётся из каталога, а не от вызывающего", async () => {
    await recordFunnelStepAsync({ funnel: "ps-park", step: "view", sessionKey: "s1" });
    const arg = mockCreate.mock.calls[0][0] as { data: { moduleSlug: string } };
    expect(arg.data.moduleSlug).toBe("ps-park");
  });
});

describe("recordPaidStep", () => {
  it("нет предшествующего submitted — paid не пишется", async () => {
    mockFindFirst.mockResolvedValue(null);
    await recordPaidStep("cafe", "order-1");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("есть submitted — наследует его sessionKey и пишет paid", async () => {
    mockFindFirst.mockResolvedValue({ sessionKey: "inherited-key" });
    await recordPaidStep("cafe", "order-1", { amountRub: 500 });
    expect(mockCreate).toHaveBeenCalledOnce();
    const arg = mockCreate.mock.calls[0][0] as {
      data: { sessionKey: string; step: string; entityId: string; metadata: unknown };
    };
    expect(arg.data.sessionKey).toBe("inherited-key");
    expect(arg.data.step).toBe("paid");
    expect(arg.data.entityId).toBe("order-1");
    expect(arg.data.metadata).toEqual({ amountRub: 500 });
  });

  it("воронка без шага paid (rental) — тихо игнорируется, БД не трогается", async () => {
    await recordPaidStep("rental", "inquiry-1");
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("незнакомый moduleSlug (например subscriptions) — тихо игнорируется", async () => {
    await recordPaidStep("subscriptions", "sub-1");
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("никогда не бросает, даже если findFirst отклоняется", async () => {
    mockFindFirst.mockRejectedValue(new Error("db down"));
    await expect(recordPaidStep("cafe", "order-1")).resolves.toBeUndefined();
  });
});

describe("getFunnelStats", () => {
  it("считает конверсию от предыдущего и от первого шага", async () => {
    mockQueryRaw.mockResolvedValue([
      { funnel: "gazebos", step: "view", events: 100, sessions: 100 },
      { funnel: "gazebos", step: "slot_selected", events: 40, sessions: 40 },
      { funnel: "gazebos", step: "submitted", events: 10, sessions: 10 },
      { funnel: "gazebos", step: "paid", events: 5, sessions: 5 },
    ]);

    const result = await getFunnelStats({
      funnel: "gazebos",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-07",
    });

    const funnel = result.funnels[0];
    expect(funnel.steps[0]).toMatchObject({ sessions: 100, conversionFromPrev: null, conversionFromTop: 100 });
    expect(funnel.steps[1]).toMatchObject({ sessions: 40, conversionFromPrev: 40, conversionFromTop: 40 });
    expect(funnel.steps[2]).toMatchObject({ sessions: 10, conversionFromPrev: 25, conversionFromTop: 10 });
    expect(funnel.steps[3]).toMatchObject({ sessions: 5, conversionFromPrev: 50, conversionFromTop: 5 });
    // Худшая конверсия среди шагов после первого: slot_selected 40%,
    // submitted 25%, paid 50% — минимум у submitted.
    expect(funnel.biggestDropStep).toBe("submitted");
  });

  it("пустой период — нулевые шаги, без деления на ноль", async () => {
    mockQueryRaw.mockResolvedValue([]);

    const result = await getFunnelStats({
      funnel: "rental",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-07",
    });

    const funnel = result.funnels[0];
    expect(funnel.steps.every((s) => s.events === 0 && s.sessions === 0)).toBe(true);
    expect(funnel.steps[0].conversionFromPrev).toBeNull();
    expect(funnel.steps[1].conversionFromPrev).toBe(0);
    // Нет данных вовсе → всё 0%, "худший" шаг — первый после view (0 везде,
    // не деление на ноль и не NaN).
    expect(funnel.biggestDropStep).toBe("form_started");
  });

  it("без funnel в параметрах — считает по всем воронкам каталога", async () => {
    mockQueryRaw.mockResolvedValue([]);
    const result = await getFunnelStats({ dateFrom: "2026-09-01", dateTo: "2026-09-07" });
    expect(result.funnels.map((f) => f.funnel).sort()).toEqual(
      ["cafe", "gazebos", "ps-park", "rental"].sort()
    );
  });
});
