import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// route.ts читает TELEGRAM_BOT_TOKEN в константу модуля при импорте —
// vi.stubEnv в beforeEach опоздал бы, поэтому ставим до импорта модуля.
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => ({
    user: { id: "admin-1", role: "SUPERADMIN", name: "Admin" },
  })),
}));

vi.mock("@/lib/api-response", async () => {
  const actual = await vi.importActual("@/lib/api-response");
  return {
    ...actual,
    requireAdminSection: vi.fn(() => null),
  };
});

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    module: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import { POST } from "../route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/notifications/routing/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue({ config: { telegramAdminChatId: "-100777" } });
  mockUpdate.mockResolvedValue({});
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ ok: true, result: { chat: { title: "Category chat" } } }),
  }) as never;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/notifications/routing/test", () => {
  it("sends a test message for a known category", async () => {
    const res = await POST(makeRequest({ key: "gazebos" }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // #471: как userName, так и label (при неизвестном key — сам key,
  // напрямую из тела запроса без валидации по enum) подставлялись в
  // parse_mode:"HTML" сообщение без экранирования.
  it("экранирует имя отправителя в тексте тестового сообщения (#471)", async () => {
    const { auth } = await import("@/lib/auth");
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: "admin-1", role: "SUPERADMIN", name: "<b>Admin</b>" },
    } as never);

    await POST(makeRequest({ key: "gazebos" }));

    const tgBody = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string
    );
    expect(tgBody.text).toContain("&lt;b&gt;Admin&lt;/b&gt;");
    expect(tgBody.text).not.toContain("<b>Admin</b>");
  });

  it("экранирует key как label, если он не входит в CATEGORY_LABELS (#471)", async () => {
    await POST(makeRequest({ key: '<img src=x onerror=alert(1)>' }));

    const tgBody = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string
    );
    expect(tgBody.text).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(tgBody.text).not.toContain("<img src=");
  });
});
