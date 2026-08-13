import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/webapp-auth", () => ({ verifyWebAppToken: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn() }));

const mockGetWebappFeed = vi.fn();
const mockMarkFeedRead = vi.fn();
vi.mock("@/modules/notifications/feed", () => ({
  getWebappFeed: (...args: unknown[]) => mockGetWebappFeed(...args),
  markFeedRead: (...args: unknown[]) => mockMarkFeedRead(...args),
}));

import { verifyWebAppToken } from "@/lib/webapp-auth";
import { rateLimit } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-response";
import { GET } from "../route";
import { POST } from "../read/route";

const mockUser = { id: "user-1", telegramId: "tg-123", role: "USER" };

const EMPTY_PAGE = { items: [], nextCursor: null, unreadCount: 0 };

function getRequest(query = "") {
  return new NextRequest(`http://localhost/api/webapp/feed${query}`, {
    method: "GET",
  });
}

function readRequest(body: unknown) {
  return new NextRequest("http://localhost/api/webapp/feed/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(verifyWebAppToken).mockResolvedValue(mockUser);
  vi.mocked(rateLimit).mockResolvedValue(null);
  mockGetWebappFeed.mockResolvedValue(EMPTY_PAGE);
  mockMarkFeedRead.mockResolvedValue({ updated: 0, feedSeenAt: null, unreadCount: 0 });
});

describe("GET /api/webapp/feed", () => {
  it("returns 401 without a valid token and never touches the service", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(null);

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error.code).toBe("UNAUTHORIZED");
    expect(mockGetWebappFeed).not.toHaveBeenCalled();
    // Лимит считается по пользователю — до верификации токена его нет.
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it("happy path: returns the feed page and scopes it to the token user", async () => {
    mockGetWebappFeed.mockResolvedValue({
      items: [
        {
          id: "on:n-1",
          kind: "personal",
          eventType: "booking.created",
          title: "Бронь подтверждена",
          body: "Беседка №3",
          actions: [{ label: "Открыть", url: "/webapp/bookings" }],
          createdAt: "2026-08-13T09:00:00.000Z",
          readAt: null,
          moduleSlug: "gazebos",
        },
      ],
      nextCursor: "2026-08-13T09:00:00.000Z",
      unreadCount: 1,
    });

    const res = await GET(getRequest("?limit=10&cursor=2026-08-13T12:00:00.000Z"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.items).toHaveLength(1);
    expect(json.data.unreadCount).toBe(1);
    expect(mockGetWebappFeed).toHaveBeenCalledWith("user-1", {
      limit: 10,
      cursor: "2026-08-13T12:00:00.000Z",
    });
    expect(rateLimit).toHaveBeenCalledWith(expect.anything(), "authenticated", "user-1");
  });

  it("applies the default limit when the query is empty", async () => {
    await GET(getRequest());

    expect(mockGetWebappFeed).toHaveBeenCalledWith("user-1", { limit: 20 });
  });

  it("returns 422 for limit=0", async () => {
    const res = await GET(getRequest("?limit=0"));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockGetWebappFeed).not.toHaveBeenCalled();
  });

  it("returns 422 for limit=500", async () => {
    const res = await GET(getRequest("?limit=500"));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockGetWebappFeed).not.toHaveBeenCalled();
  });

  it("returns 422 for a malformed cursor", async () => {
    const res = await GET(getRequest("?cursor=вчера"));

    expect(res.status).toBe(422);
    expect(mockGetWebappFeed).not.toHaveBeenCalled();
  });

  it("propagates 429 from the rate limiter", async () => {
    vi.mocked(rateLimit).mockResolvedValue(
      apiError("RATE_LIMIT_EXCEEDED", "Слишком много запросов", 429)
    );

    const res = await GET(getRequest());

    expect(res.status).toBe(429);
    expect(mockGetWebappFeed).not.toHaveBeenCalled();
  });

  it("returns 500 without leaking internals when the service throws", async () => {
    mockGetWebappFeed.mockRejectedValue(new Error("db down"));

    const res = await GET(getRequest());
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error.code).toBe("INTERNAL_ERROR");
    expect(json.error.message).not.toContain("db down");
  });
});

describe("POST /api/webapp/feed/read", () => {
  it("returns 401 without a valid token", async () => {
    vi.mocked(verifyWebAppToken).mockResolvedValue(null);

    const res = await POST(readRequest({ ids: ["on:n-1"] }));

    expect(res.status).toBe(401);
    expect(mockMarkFeedRead).not.toHaveBeenCalled();
  });

  it("marks the feed read up to a watermark", async () => {
    mockMarkFeedRead.mockResolvedValue({
      updated: 3,
      feedSeenAt: "2026-08-13T12:00:00.000Z",
      unreadCount: 0,
    });

    const res = await POST(readRequest({ upTo: "2026-08-13T12:00:00.000Z" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({
      updated: 3,
      feedSeenAt: "2026-08-13T12:00:00.000Z",
      unreadCount: 0,
    });
    expect(mockMarkFeedRead).toHaveBeenCalledWith("user-1", {
      upTo: "2026-08-13T12:00:00.000Z",
    });
  });

  it("someone else's id is passed to the service under the caller's own userId", async () => {
    const res = await POST(readRequest({ ids: ["on:foreign-row"] }));

    expect(res.status).toBe(200);
    // Сервис пишет строго с where.userId = первый аргумент; чужой id не может
    // прийти с чужим userId, потому что userId берётся из токена, а не из body.
    expect(mockMarkFeedRead).toHaveBeenCalledWith("user-1", { ids: ["on:foreign-row"] });
    expect(mockMarkFeedRead).toHaveBeenCalledTimes(1);
  });

  it("ignores userId supplied in the body", async () => {
    await POST(readRequest({ ids: ["on:n-1"], userId: "user-2" }));

    expect(mockMarkFeedRead).toHaveBeenCalledWith("user-1", { ids: ["on:n-1"] });
  });

  it("returns 422 when neither ids nor upTo is given", async () => {
    const res = await POST(readRequest({}));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mockMarkFeedRead).not.toHaveBeenCalled();
  });

  it("returns 422 for a malformed body", async () => {
    const res = await POST(readRequest("{not json"));

    expect(res.status).toBe(422);
    expect(mockMarkFeedRead).not.toHaveBeenCalled();
  });

  it("propagates 429 from the rate limiter", async () => {
    vi.mocked(rateLimit).mockResolvedValue(
      apiError("RATE_LIMIT_EXCEEDED", "Слишком много запросов", 429)
    );

    const res = await POST(readRequest({ ids: ["on:n-1"] }));

    expect(res.status).toBe(429);
    expect(mockMarkFeedRead).not.toHaveBeenCalled();
  });
});
