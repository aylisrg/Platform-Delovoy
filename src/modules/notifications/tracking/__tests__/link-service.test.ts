import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    notificationLink: { upsert: vi.fn(), findUnique: vi.fn() },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import {
  ensureLinksForDelivery,
  generateLinkCode,
  isAutomatedRequest,
  LINK_CODE_RE,
  LINK_TTL_DAYS,
  normalizeTrackableTarget,
  recordLinkClick,
  resolveLinkForRedirect,
} from "../link-service";

const opts = { appOrigin: "https://delovoy-park.ru", botUsername: "DelovoyPark_bot" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://delovoy-park.ru");
  vi.stubEnv("TELEGRAM_BOT_USERNAME", "DelovoyPark_bot");
});

describe("generateLinkCode (AC-D3.5)", () => {
  it("22 base64url chars, unique", () => {
    const a = generateLinkCode();
    expect(a).toMatch(LINK_CODE_RE);
    expect(generateLinkCode()).not.toBe(a);
  });
});

describe("normalizeTrackableTarget — open redirect is impossible (AC-D3.3)", () => {
  it.each([
    ["/admin/gazebos?date=2026-10-25", "https://delovoy-park.ru/admin/gazebos?date=2026-10-25"],
    ["https://delovoy-park.ru/webapp/feed", "https://delovoy-park.ru/webapp/feed"],
    ["https://t.me/DelovoyPark_bot", "https://t.me/DelovoyPark_bot"],
    ["https://t.me/delovoypark_bot?start=x", "https://t.me/delovoypark_bot?start=x"],
  ])("allows %s", (raw, expected) => {
    expect(normalizeTrackableTarget(raw, opts)).toBe(expected);
  });

  it.each([
    "//evil.example/path",
    "\\\\evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://user@delovoy-park.ru/admin",
    "https://evil.example",
    "https://delovoy-park.ru.evil.example/",
    "http://delovoy-park.ru/admin",
    "https://t.me/other_bot",
    "https://t.me/DelovoyPark_botx",
    "%2F%2Fevil.example",
    "/%2F%2Fevil.example".replace("/", "%2F"),
    " https://evil.example",
    "/admin\u0000",
    "/admin gazebos",
    "",
    42,
    null,
  ])("rejects %s", (raw) => {
    expect(normalizeTrackableTarget(raw, opts)).toBeNull();
  });

  it("double-encoded paths stay on the platform origin", () => {
    const out = normalizeTrackableTarget("/%252F%252Fevil.example", opts);
    expect(out).not.toBeNull();
    expect(new URL(out!).origin).toBe("https://delovoy-park.ru");
  });

  it("http is accepted only when the platform itself runs on http (dev)", () => {
    expect(normalizeTrackableTarget("http://localhost:3000/admin", { ...opts, appOrigin: "http://localhost:3000" })).toBe(
      "http://localhost:3000/admin",
    );
  });
});

describe("ensureLinksForDelivery (AC-D3.1)", () => {
  it("upserts one link per (chain root, action index) and drops disallowed actions", async () => {
    vi.mocked(prisma.notificationLink.upsert).mockResolvedValue({ code: "AAAAAAAAAAAAAAAAAAAAAA" } as never);
    const out = await ensureLinksForDelivery(
      { id: "fallback-row", fallbackOfId: "root", userId: "u1", eventType: "booking.created" },
      [
        { label: "Открыть", url: "/admin/gazebos" },
        { label: "Чужая", url: "https://evil.example" },
        { label: "Без ссылки" },
      ],
    );
    expect(out).toEqual([
      { label: "Открыть", url: "https://delovoy-park.ru/r/AAAAAAAAAAAAAAAAAAAAAA", target: "/admin/gazebos" },
    ]);
    expect(prisma.notificationLink.upsert).toHaveBeenCalledTimes(1);
    const call = vi.mocked(prisma.notificationLink.upsert).mock.calls[0][0];
    expect(call.where).toEqual({ outgoingId_actionIndex: { outgoingId: "root", actionIndex: 0 } });
    expect(call.update).toEqual({});
    expect(call.create).toMatchObject({ outgoingId: "root", userId: "u1", targetUrl: "https://delovoy-park.ru/admin/gazebos" });
    const ttlDays = ((call.create.expiresAt as Date).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(ttlDays)).toBe(LINK_TTL_DAYS);
  });

  it("no actions → nothing written", async () => {
    expect(await ensureLinksForDelivery({ id: "x", fallbackOfId: null, userId: "u", eventType: "e" }, undefined)).toEqual([]);
    expect(prisma.notificationLink.upsert).not.toHaveBeenCalled();
  });
});

describe("resolveLinkForRedirect (AC-D3.4, AC-D3.8)", () => {
  const code = "AAAAAAAAAAAAAAAAAAAAAA";
  it("returns the stored target for a valid unexpired code", async () => {
    vi.mocked(prisma.notificationLink.findUnique).mockResolvedValue({
      id: "l1", outgoingId: "root", targetUrl: "https://delovoy-park.ru/admin", expiresAt: new Date(Date.now() + 1000),
    } as never);
    expect(await resolveLinkForRedirect(code)).toEqual({ target: "https://delovoy-park.ru/admin", linkId: "l1", rootId: "root" });
  });

  it("malformed / unknown / expired / no-longer-allowed → null", async () => {
    expect(await resolveLinkForRedirect("short")).toBeNull();
    expect(prisma.notificationLink.findUnique).not.toHaveBeenCalled();
    vi.mocked(prisma.notificationLink.findUnique).mockResolvedValueOnce(null);
    expect(await resolveLinkForRedirect(code)).toBeNull();
    vi.mocked(prisma.notificationLink.findUnique).mockResolvedValueOnce({
      id: "l1", outgoingId: "r", targetUrl: "https://delovoy-park.ru/x", expiresAt: new Date(Date.now() - 1),
    } as never);
    expect(await resolveLinkForRedirect(code)).toBeNull();
    vi.mocked(prisma.notificationLink.findUnique).mockResolvedValueOnce({
      id: "l1", outgoingId: "r", targetUrl: "https://evil.example", expiresAt: new Date(Date.now() + 1000),
    } as never);
    expect(await resolveLinkForRedirect(code)).toBeNull();
  });
});

describe("recordLinkClick (AC-D3.7)", () => {
  it("updates link and chain root in one transaction keeping the first click", async () => {
    await recordLinkClick("l1", "root", new Date("2026-10-25T10:00:00Z"));
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(prisma.$executeRaw).mock.calls.map((c) => (c[0] as unknown as string[]).join("?"));
    expect(sql[0]).toMatch(/"firstClickAt" = COALESCE\("firstClickAt"/);
    expect(sql[1]).toMatch(/UPDATE "OutgoingNotification"[\s\S]*"clickedAt" = COALESCE\("clickedAt"/);
  });
});

describe("isAutomatedRequest (AC-D3.6)", () => {
  const h = (init: Record<string, string>) => new Headers(init);
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

  it("HEAD, empty UA, crawlers and prefetch are not clicks", () => {
    expect(isAutomatedRequest(h({ "user-agent": iphone }), "HEAD")).toBe(true);
    expect(isAutomatedRequest(h({}), "GET")).toBe(true);
    expect(isAutomatedRequest(h({ "user-agent": "TelegramBot (like TwitterBot)" }), "GET")).toBe(true);
    expect(isAutomatedRequest(h({ "user-agent": "Mozilla/5.0 (compatible; YandexBot/3.0)" }), "GET")).toBe(true);
    expect(isAutomatedRequest(h({ "user-agent": "WhatsApp/2.23" }), "GET")).toBe(true);
    expect(isAutomatedRequest(h({ "user-agent": iphone, "sec-purpose": "prefetch" }), "GET")).toBe(true);
  });

  it("real people, incl. Telegram's in-app browser and the Yandex app, are clicks", () => {
    expect(isAutomatedRequest(h({ "user-agent": iphone }), "GET")).toBe(false);
    expect(isAutomatedRequest(h({ "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Telegram-Android/11.2.3" }), "GET")).toBe(false);
    expect(isAutomatedRequest(h({ "user-agent": "Mozilla/5.0 (Linux; Android 13) YaApp_Android/24.10 YaSearchBrowser/24.10" }), "GET")).toBe(false);
  });
});
