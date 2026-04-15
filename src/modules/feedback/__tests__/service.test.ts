import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    feedbackItem: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    feedbackComment: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    systemEvent: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/redis", () => ({
  redis: {
    get: vi.fn(),
    pipeline: vi.fn(() => ({
      incr: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn(),
    })),
  },
  redisAvailable: true,
}));

vi.mock("@/modules/feedback/telegram", () => ({
  sendUrgentFeedbackAlert: vi.fn().mockResolvedValue(true),
}));

import {
  createFeedback,
  listFeedback,
  getFeedbackById,
  updateFeedbackStatus,
  addComment,
  getFeedbackStats,
  RateLimitError,
  NotFoundError,
} from "@/modules/feedback/service";
import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { sendUrgentFeedbackAlert } from "@/modules/feedback/telegram";

const mockUser = { id: "user-1", name: "Иван", email: "ivan@test.com" };

const mockFeedback = (overrides = {}) => ({
  id: "fb-1",
  userId: "user-1",
  type: "BUG" as const,
  description: "Кнопка не работает",
  pageUrl: "/gazebos",
  isUrgent: false,
  status: "NEW" as const,
  screenshotPath: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: mockUser,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(redis.get).mockResolvedValue(null);
});

describe("createFeedback", () => {
  it("creates a non-urgent feedback item", async () => {
    const created = mockFeedback();
    vi.mocked(prisma.feedbackItem.create).mockResolvedValue(created as never);

    const result = await createFeedback("user-1", {
      type: "BUG",
      description: "Кнопка не работает",
      pageUrl: "/gazebos",
      isUrgent: false,
    });

    expect(result).toEqual({ id: "fb-1" });
    expect(prisma.feedbackItem.create).toHaveBeenCalledOnce();
    expect(sendUrgentFeedbackAlert).not.toHaveBeenCalled();
  });

  it("creates an urgent feedback and triggers Telegram alert", async () => {
    const created = mockFeedback({ isUrgent: true });
    vi.mocked(prisma.feedbackItem.create).mockResolvedValue(created as never);

    const result = await createFeedback("user-1", {
      type: "BUG",
      description: "Сайт упал полностью",
      pageUrl: "/",
      isUrgent: true,
    });

    expect(result).toEqual({ id: "fb-1" });
    // Wait for the async Telegram call (it's fire-and-forget with .catch)
    await new Promise((r) => setTimeout(r, 10));
    expect(sendUrgentFeedbackAlert).toHaveBeenCalledOnce();
    expect(sendUrgentFeedbackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        feedbackId: "fb-1",
        type: "BUG",
        userName: "Иван",
      })
    );
  });

  it("throws RateLimitError when daily limit exceeded", async () => {
    vi.mocked(redis.get).mockResolvedValue("5");

    await expect(
      createFeedback("user-1", {
        type: "BUG",
        description: "Ещё одно обращение",
        pageUrl: "/",
        isUrgent: false,
      })
    ).rejects.toThrow(RateLimitError);
  });

  it("throws RateLimitError when urgent hourly limit exceeded", async () => {
    vi.mocked(redis.get).mockImplementation(async (key) => {
      if (String(key).includes("urgent")) return "1";
      return "2";
    });

    await expect(
      createFeedback("user-1", {
        type: "BUG",
        description: "Срочная ошибка!!!!!",
        pageUrl: "/",
        isUrgent: true,
      })
    ).rejects.toThrow(RateLimitError);
  });
});

describe("listFeedback", () => {
  it("returns paginated list for USER (own items only)", async () => {
    const items = [mockFeedback()];
    vi.mocked(prisma.feedbackItem.findMany).mockResolvedValue(items as never);
    vi.mocked(prisma.feedbackItem.count).mockResolvedValue(1);

    const result = await listFeedback("user-1", "USER", { page: 1, perPage: 20 });

    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(prisma.feedbackItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-1" }),
      })
    );
  });

  it("returns all items for SUPERADMIN", async () => {
    const items = [mockFeedback(), mockFeedback({ id: "fb-2", userId: "user-2" })];
    vi.mocked(prisma.feedbackItem.findMany).mockResolvedValue(items as never);
    vi.mocked(prisma.feedbackItem.count).mockResolvedValue(2);

    const result = await listFeedback("admin-1", "SUPERADMIN", { page: 1, perPage: 20 });

    expect(result.items).toHaveLength(2);
    expect(prisma.feedbackItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ userId: expect.anything() }),
      })
    );
  });

  it("applies status filter", async () => {
    vi.mocked(prisma.feedbackItem.findMany).mockResolvedValue([]);
    vi.mocked(prisma.feedbackItem.count).mockResolvedValue(0);

    await listFeedback("admin-1", "SUPERADMIN", {
      page: 1,
      perPage: 20,
      status: "IN_PROGRESS",
    });

    expect(prisma.feedbackItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "IN_PROGRESS" }),
      })
    );
  });
});

describe("getFeedbackById", () => {
  it("returns feedback with comments for author", async () => {
    const fb = {
      ...mockFeedback(),
      comments: [
        {
          id: "comment-1",
          feedbackId: "fb-1",
          authorId: "admin-1",
          text: "Исправим!",
          createdAt: new Date(),
        },
      ],
    };
    vi.mocked(prisma.feedbackItem.findUnique).mockResolvedValue(fb as never);
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "admin-1", name: "Администратор" },
    ] as never);

    const result = await getFeedbackById("fb-1", "user-1", "USER");

    expect(result).not.toBeNull();
    expect(result?.comments).toHaveLength(1);
    expect(result?.comments[0].authorName).toBe("Администратор");
  });

  it("returns null for non-author USER", async () => {
    vi.mocked(prisma.feedbackItem.findUnique).mockResolvedValue(
      mockFeedback({ userId: "user-2" }) as never
    );

    const result = await getFeedbackById("fb-1", "user-1", "USER");
    expect(result).toBeNull();
  });

  it("allows SUPERADMIN to see any feedback", async () => {
    vi.mocked(prisma.feedbackItem.findUnique).mockResolvedValue({
      ...mockFeedback({ userId: "user-2" }),
      comments: [],
    } as never);

    const result = await getFeedbackById("fb-1", "admin-1", "SUPERADMIN");
    expect(result).not.toBeNull();
  });
});

describe("updateFeedbackStatus", () => {
  it("updates status and logs audit", async () => {
    vi.mocked(prisma.feedbackItem.findUnique).mockResolvedValue(
      mockFeedback() as never
    );
    vi.mocked(prisma.feedbackItem.update).mockResolvedValue({
      id: "fb-1",
      status: "IN_PROGRESS",
      updatedAt: new Date(),
    } as never);

    const result = await updateFeedbackStatus("fb-1", "IN_PROGRESS", "admin-1");

    expect(result.status).toBe("IN_PROGRESS");
    expect(prisma.feedbackItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "fb-1" },
        data: { status: "IN_PROGRESS" },
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it("throws NotFoundError for non-existent feedback", async () => {
    vi.mocked(prisma.feedbackItem.findUnique).mockResolvedValue(null);

    await expect(
      updateFeedbackStatus("fb-999", "RESOLVED", "admin-1")
    ).rejects.toThrow(NotFoundError);
  });
});

describe("addComment", () => {
  it("adds a comment to existing feedback", async () => {
    vi.mocked(prisma.feedbackItem.findUnique).mockResolvedValue(
      mockFeedback() as never
    );
    vi.mocked(prisma.user.findUnique).mockResolvedValue(
      { name: "Администратор" } as never
    );
    vi.mocked(prisma.feedbackComment.create).mockResolvedValue({
      id: "comment-1",
      feedbackId: "fb-1",
      authorId: "admin-1",
      text: "Посмотрим",
      createdAt: new Date(),
    } as never);

    const result = await addComment("fb-1", "admin-1", "Посмотрим");

    expect(result.authorName).toBe("Администратор");
    expect(prisma.feedbackComment.create).toHaveBeenCalledOnce();
  });

  it("throws NotFoundError for non-existent feedback", async () => {
    vi.mocked(prisma.feedbackItem.findUnique).mockResolvedValue(null);

    await expect(
      addComment("fb-999", "admin-1", "Комментарий")
    ).rejects.toThrow(NotFoundError);
  });
});

describe("getFeedbackStats", () => {
  it("returns correct counts", async () => {
    vi.mocked(prisma.feedbackItem.count)
      .mockResolvedValueOnce(5)  // totalNew
      .mockResolvedValueOnce(2)  // totalUrgentNew
      .mockResolvedValueOnce(3)  // totalInProgress
      .mockResolvedValueOnce(10) // totalResolved
      .mockResolvedValueOnce(1); // totalRejected

    const stats = await getFeedbackStats();

    expect(stats).toEqual({
      totalNew: 5,
      totalUrgentNew: 2,
      totalInProgress: 3,
      totalResolved: 10,
      totalRejected: 1,
    });
  });
});
