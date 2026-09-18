import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCanSend, mockGenerate, mockSendEmail } = vi.hoisted(() => ({
  mockCanSend: vi.fn(),
  mockGenerate: vi.fn(),
  mockSendEmail: vi.fn(),
}));

vi.mock("@/modules/auth/email-magic-link.service", () => ({
  canSendMagicLink: mockCanSend,
  generateAndStoreMagicLink: mockGenerate,
  sendMagicLinkEmail: mockSendEmail,
}));

import { POST } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXTAUTH_URL", "https://example.test");
  mockCanSend.mockResolvedValue(true);
  mockGenerate.mockResolvedValue("tok");
  mockSendEmail.mockResolvedValue(undefined);
});

function post(body: unknown): Request {
  return new Request("https://example.test/api/auth/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Третий аргумент generateAndStoreMagicLink — нормализованный адрес возврата. */
function storedCallbackUrl(): unknown {
  return mockGenerate.mock.calls.at(-1)?.[2];
}

describe("POST /api/auth/email/send", () => {
  it("happy path: письмо уходит, ответ не раскрывает существование аккаунта", async () => {
    const res = await POST(post({ email: "u@e.com" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: { sent: true } });
    expect(mockSendEmail).toHaveBeenCalledWith("u@e.com", "tok");
  });

  it("невалидный email → 422, письмо не уходит", async () => {
    const res = await POST(post({ email: "не-email" }));

    expect(res.status).toBe(422);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("кулдаун → 429, письмо не уходит", async () => {
    mockCanSend.mockResolvedValue(false);

    const res = await POST(post({ email: "u@e.com" }));

    expect(res.status).toBe(429);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

/**
 * Адрес возврата (PR #916). Значение приходит из query-строки страницы входа,
 * то есть от того, кто прислал ссылку. Нормализуем ДО записи в Redis: иначе
 * письмо стало бы инструментом увода пользователя на чужой домен сразу после
 * успешного входа.
 */
describe("POST /api/auth/email/send — адрес возврата", () => {
  it("свой путь сохраняется как есть", async () => {
    await POST(post({ email: "u@e.com", callbackUrl: "/for-team" }));

    expect(storedCallbackUrl()).toBe("/for-team");
  });

  it("абсолютный URL своего origin схлопывается до пути", async () => {
    await POST(
      post({ email: "u@e.com", callbackUrl: "https://example.test/admin/cafe" }),
    );

    expect(storedCallbackUrl()).toBe("/admin/cafe");
  });

  it.each(["//evil.com", "/\\evil.com", "https://evil.com/phish", "javascript:alert(1)"])(
    "чужой адрес %s до Redis не доезжает",
    async (evil) => {
      await POST(post({ email: "u@e.com", callbackUrl: evil }));

      expect(storedCallbackUrl()).toBeNull();
      // Вход при этом не ломается — письмо всё равно отправлено.
      expect(mockSendEmail).toHaveBeenCalled();
    },
  );

  it("без адреса передаётся null, поведение прежнее", async () => {
    await POST(post({ email: "u@e.com" }));

    expect(storedCallbackUrl()).toBeNull();
  });

  it("слишком длинное значение отсекается схемой до обработки", async () => {
    const res = await POST(
      post({ email: "u@e.com", callbackUrl: "/" + "a".repeat(2048) }),
    );

    expect(res.status).toBe(422);
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
