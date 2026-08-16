import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    avitoIntegration: { findUnique: vi.fn() },
    avitoMessage: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/avito/messenger", () => ({
  listChatsUnread: vi.fn(),
  listMessages: vi.fn(),
}));
vi.mock("@/lib/avito/lead-routing", () => ({
  routeInboundMessage: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { prisma } from "@/lib/db";
import { listChatsUnread, listMessages } from "@/lib/avito/messenger";
import { routeInboundMessage } from "@/lib/avito/lead-routing";
import { log } from "@/lib/logger";
import { EVENT_SOURCES } from "@/lib/event-sources";
import { GET, POST } from "../route";

const mockedFindIntegration = vi.mocked(prisma.avitoIntegration.findUnique);
const mockedFindLastMessage = vi.mocked(prisma.avitoMessage.findFirst);
const mockedLogError = vi.mocked(log.error);
const mockedListChats = vi.mocked(listChatsUnread);
const mockedListMessages = vi.mocked(listMessages);
const mockedRoute = vi.mocked(routeInboundMessage);

function makeReq(token: string | null, method: "GET" | "POST" = "GET"): NextRequest {
  const url =
    token === null
      ? "http://localhost/api/cron/avito-messenger-poll"
      : `http://localhost/api/cron/avito-messenger-poll?token=${encodeURIComponent(token)}`;
  return new NextRequest(url, { method });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.NEXTAUTH_SECRET;
  process.env.AVITO_CRON_ENABLED = "true";
  mockedFindIntegration.mockResolvedValue({
    pollEnabled: true,
    avitoUserId: "avito-user-1",
  } as never);
  mockedFindLastMessage.mockResolvedValue(null);
  mockedListChats.mockResolvedValue([]);
  mockedListMessages.mockResolvedValue([]);
  mockedLogError.mockResolvedValue(undefined as never);
});

describe("GET /api/cron/avito-messenger-poll", () => {
  it("returns 401 when token is missing or wrong", async () => {
    for (const req of [makeReq(null), makeReq("wrong")]) {
      const res = await GET(req);
      expect(res.status).toBe(401);
    }
    expect(mockedListChats).not.toHaveBeenCalled();
  });

  it("skips when AVITO_CRON_ENABLED is not 'true'", async () => {
    delete process.env.AVITO_CRON_ENABLED;
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.skipped).toBe(true);
    expect(mockedListChats).not.toHaveBeenCalled();
  });

  it("skips when pollEnabled is false", async () => {
    mockedFindIntegration.mockResolvedValue({ pollEnabled: false, avitoUserId: "u1" } as never);
    const res = await GET(makeReq("test-cron-secret"));
    const body = await res.json();
    expect(body.data.skipped).toBe(true);
    expect(body.data.reason).toBe("pollEnabled=false");
    expect(mockedListChats).not.toHaveBeenCalled();
  });

  it("skips when avitoUserId is not set", async () => {
    mockedFindIntegration.mockResolvedValue({ pollEnabled: true, avitoUserId: null } as never);
    const res = await GET(makeReq("test-cron-secret"));
    const body = await res.json();
    expect(body.data.skipped).toBe(true);
    expect(body.data.reason).toBe("avitoUserId not set");
    expect(mockedListChats).not.toHaveBeenCalled();
  });

  it("happy path: polls unread chats, routes new messages", async () => {
    mockedListChats.mockResolvedValue([{ chatId: "c1", itemId: "i1" }] as never);
    mockedListMessages.mockResolvedValue([
      {
        avitoMessageId: "m1",
        avitoChatId: "c1",
        avitoItemId: "i1",
        authorAvitoUserId: "a1",
        body: "hi",
        receivedAt: new Date(),
        rawPayload: {},
      },
    ] as never);
    mockedRoute.mockResolvedValue({ idempotent: false } as never);

    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockedRoute).toHaveBeenCalledTimes(1);
    expect(body.data).toEqual({ chats: 1, processed: 1, skipped: 0 });
  });

  it("counts idempotent (already-routed) messages as skipped, not processed", async () => {
    mockedListChats.mockResolvedValue([{ chatId: "c1", itemId: "i1" }] as never);
    mockedListMessages.mockResolvedValue([
      {
        avitoMessageId: "m1",
        avitoChatId: "c1",
        authorAvitoUserId: "a1",
        body: "hi",
        receivedAt: new Date(),
        rawPayload: {},
      },
    ] as never);
    mockedRoute.mockResolvedValue({ idempotent: true } as never);

    const res = await GET(makeReq("test-cron-secret"));
    const body = await res.json();
    expect(body.data).toEqual({ chats: 1, processed: 0, skipped: 1 });
  });

  it("logs a SystemEvent and continues when routing a message fails", async () => {
    mockedListChats.mockResolvedValue([{ chatId: "c1", itemId: "i1" }] as never);
    mockedListMessages.mockResolvedValue([
      {
        avitoMessageId: "m1",
        avitoChatId: "c1",
        authorAvitoUserId: "a1",
        body: "hi",
        receivedAt: new Date(),
        rawPayload: {},
      },
    ] as never);
    mockedRoute.mockRejectedValue(new Error("routing failed"));

    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ chats: 1, processed: 0, skipped: 0 });
    expect(mockedLogError).toHaveBeenCalledTimes(1);
    expect(mockedLogError).toHaveBeenCalledWith(
      EVENT_SOURCES.AVITO_CRON_POLL,
      "avito.cron.routing_failed",
      expect.objectContaining({ avitoMessageId: "m1" })
    );
  });

  it("returns 500 when listChatsUnread itself throws", async () => {
    mockedListChats.mockRejectedValue(new Error("avito api down"));
    const res = await GET(makeReq("test-cron-secret"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/cron/avito-messenger-poll", () => {
  it("rejects invalid token with 401 (same as GET)", async () => {
    const res = await POST(makeReq("nope", "POST"));
    expect(res.status).toBe(401);
  });
});
