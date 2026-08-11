import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));

const mockRequireAdminSection = vi.fn();
vi.mock("@/lib/api-response", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-response")>("@/lib/api-response");
  return {
    ...actual,
    requireAdminSection: (...args: unknown[]) => mockRequireAdminSection(...args),
  };
});

const mockRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}));

import { POST } from "../route";
import { apiUnauthorized, apiError } from "@/lib/api-response";

function makeRequest(body: unknown = {}) {
  return new NextRequest("http://localhost/api/ps-park/session-ending-alert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  bookingId: "bk-1",
  resourceName: "PS5 #3",
  clientName: "Иван",
  remainingMinutes: 10,
};

/** Тело последнего вызова Telegram sendMessage. */
function lastTelegramPayload() {
  const [, init] = vi.mocked(global.fetch).mock.calls[0];
  return JSON.parse((init as RequestInit).body as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.stubEnv("TELEGRAM_ADMIN_CHAT_ID", "-100999");
  mockAuth.mockResolvedValue({ user: { id: "admin-1", role: "SUPERADMIN" } });
  mockRequireAdminSection.mockResolvedValue(null);
  mockRateLimit.mockResolvedValue(null);
  global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) }) as never;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/ps-park/session-ending-alert", () => {
  it("шлёт алерт в админ-чат при валидном теле и правах", async () => {
    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.sent).toBe(true);
    expect(lastTelegramPayload().parse_mode).toBe("HTML");
  });

  // Главная дыра из #428: роут был публичным.
  it("отдаёт 401 без сессии и в Telegram ничего не шлёт", async () => {
    mockAuth.mockResolvedValue(null);
    mockRequireAdminSection.mockResolvedValue(apiUnauthorized());

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("отдаёт ответ requireAdminSection, если у пользователя нет доступа к модулю", async () => {
    mockRequireAdminSection.mockResolvedValue(apiError("FORBIDDEN", "Нет доступа", 403));

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("уважает rate limit и не шлёт сообщение", async () => {
    mockRateLimit.mockResolvedValue(apiError("RATE_LIMIT_EXCEEDED", "Слишком много запросов", 429));

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(429);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("ключует rate limit по пользователю, а не по IP", async () => {
    await POST(makeRequest(validBody));
    expect(mockRateLimit).toHaveBeenCalledWith(expect.anything(), "authenticated", "admin-1");
  });

  it.each([
    [{ resourceName: "PS5" }, "нет bookingId"],
    [{ bookingId: "bk-1" }, "нет resourceName"],
    [{ bookingId: "bk-1", resourceName: "" }, "пустой resourceName"],
    [{ bookingId: "bk-1", resourceName: "PS5", remainingMinutes: -5 }, "отрицательные минуты"],
    [{ bookingId: "bk-1", resourceName: "PS5", remainingMinutes: 1.5 }, "дробные минуты"],
    [{ bookingId: "bk-1", resourceName: "x".repeat(101) }, "слишком длинный resourceName"],
  ])("отдаёт 422 на невалидное тело: %s", async (body: Record<string, unknown>, _case: string) => {
    const res = await POST(makeRequest(body));

    expect(res.status).toBe(422);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("отдаёт 422 на не-JSON тело, а не 500", async () => {
    const req = new NextRequest("http://localhost/api/ps-park/session-ending-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "не json",
    });

    const res = await POST(req);

    expect(res.status).toBe(422);
  });

  // Вторая дыра из #428: HTML-инъекция в админ-чат.
  it("экранирует HTML в resourceName и clientName", async () => {
    await POST(
      makeRequest({
        bookingId: "bk-1",
        resourceName: '<a href="http://evil">PS5</a>',
        clientName: "<b>Админ</b>",
        remainingMinutes: 10,
      })
    );

    const text = lastTelegramPayload().text as string;
    expect(text).toContain("&lt;a href=");
    expect(text).toContain("&lt;b&gt;Админ&lt;/b&gt;");
    // Разметка самого шаблона остаётся живой
    expect(text).toContain("<b>Осталось 10 мин</b>");
    // Ни одного неэкранированного тега из пользовательских данных
    expect(text).not.toContain("<a href=");
  });

  // Регрессия: до фикса роут терпел любой clientName. Строгий .optional() превратил
  // бы null от админ-панели в 422 и потерю алерта.
  it.each([[null], [undefined]])("принимает clientName=%s и просто не выводит строку про клиента", async (clientName) => {
    const res = await POST(makeRequest({ ...validBody, clientName }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(lastTelegramPayload().text).not.toContain("Клиент:");
  });

  it("принимает remainingMinutes=null и подставляет значение по умолчанию", async () => {
    await POST(makeRequest({ ...validBody, remainingMinutes: null }));

    expect(lastTelegramPayload().text).toContain("Осталось 10 мин");
  });

  it("экранирует амперсанд, не ломая уже вставленные сущности", async () => {
    await POST(makeRequest({ ...validBody, resourceName: "Tom & Jerry" }));

    expect(lastTelegramPayload().text).toContain("Tom &amp; Jerry");
  });

  it("без токена бота отвечает sent:false, а не падает", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");

    const res = await POST(makeRequest(validBody));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.sent).toBe(false);
  });
});
