/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing service
vi.mock("@/lib/db", () => ({
  prisma: {
    chat: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    chatParticipant: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
    },
    chatMessage: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    chatMessageReceipt: {
      createMany: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/lib/db";
import {
  canStartDirect,
  getHealthMetrics,
  sendMessage,
  listChatsForUser,
} from "../service";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getHealthMetrics ──────────────────────────────────────────────────────

describe("getHealthMetrics", () => {
  it("returns chat and message counts", async () => {
    vi.mocked(prisma.chat.count).mockResolvedValue(3);
    vi.mocked(prisma.chatMessage.count).mockResolvedValue(42);
    const metrics = await getHealthMetrics();
    expect(metrics.chatCount).toBe(3);
    expect(metrics.messageCount).toBe(42);
  });
});

// ── sendMessage idempotency ───────────────────────────────────────────────

describe("sendMessage", () => {
  it("returns existing message if clientId already used", async () => {
    const existingMsg = {
      id: "msg1",
      chatId: "chat1",
      senderUserId: "user1",
      body: "Hello",
      clientId: "key123",
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      sender: { id: "user1", name: "Alice", image: null },
      receipts: [],
    };
    vi.mocked(prisma.chatMessage.findUnique).mockResolvedValue(existingMsg as any);

    const result = await sendMessage({
      chatId: "chat1",
      senderUserId: "user1",
      body: "Hello",
      clientId: "key123",
    });

    expect(result.message.id).toBe("msg1");
    // Should NOT create a new message.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates new message via transaction when no clientId match", async () => {
    vi.mocked(prisma.chatMessage.findUnique).mockResolvedValue(null);

    const newMsg = {
      id: "msg2",
      chatId: "chat1",
      senderUserId: "user1",
      body: "Hi",
      clientId: null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      sender: { id: "user1", name: "Alice", image: null },
      receipts: [],
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const fakeTx = {
        chatMessage: {
          create: vi.fn().mockResolvedValue(newMsg),
        },
        chat: {
          update: vi.fn().mockResolvedValue({ id: "chat1", lastMessageAt: new Date(), kind: "SUPPORT" }),
        },
        chatParticipant: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          upsert: vi.fn(),
        },
      };
      return fn(fakeTx);
    });

    const result = await sendMessage({
      chatId: "chat1",
      senderUserId: "user1",
      body: "Hi",
    });

    expect(result.message.id).toBe("msg2");
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});

// ── canStartDirect eligibility ────────────────────────────────────────────

describe("canStartDirect", () => {
  it("returns false when same user id", async () => {
    const result = await canStartDirect("user1", "user1");
    expect(result.ok).toBe(false);
  });

  it("returns false when no shared connections", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    const result = await canStartDirect("userA", "userB");
    expect(result.ok).toBe(false);
  });

  it("returns true when both users share a booking resource", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([
      { resourceId: "office1" } as any,
    ]);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue({ id: "b2" } as any);
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);

    const result = await canStartDirect("userA", "userB");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe("shared_office");
    }
  });

  it("returns true when both share an admin-created group chat", async () => {
    vi.mocked(prisma.booking.findMany).mockResolvedValue([]);
    vi.mocked(prisma.booking.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({ id: "groupChat1" } as any);

    const result = await canStartDirect("userA", "userB");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reason).toBe("admin_created");
    }
  });
});

// ── listChatsForUser ──────────────────────────────────────────────────────

describe("listChatsForUser", () => {
  it("returns empty list when no chats", async () => {
    vi.mocked(prisma.chat.findMany).mockResolvedValue([]);
    const result = await listChatsForUser("user1");
    expect(result.chats).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("returns chats with participant unread count for the requesting user", async () => {
    const now = new Date();
    vi.mocked(prisma.chat.findMany).mockResolvedValue([
      {
        id: "chat1",
        kind: "SUPPORT",
        title: null,
        createdByUserId: "user1",
        lastMessageAt: now,
        archivedAt: null,
        createdAt: now,
        participants: [
          {
            userId: "user1",
            role: "MEMBER",
            joinedAt: now,
            leftAt: null,
            unreadCount: 5,
            mutedUntil: null,
            user: { name: "Alice", image: null },
          },
        ],
        messages: [],
      },
    ] as any);

    const result = await listChatsForUser("user1");
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].unreadCount).toBe(5);
    expect(result.chats[0].kind).toBe("SUPPORT");
  });
});
