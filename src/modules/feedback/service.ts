import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";
import { logAudit, log } from "@/lib/logger";
import { sendUrgentFeedbackAlert } from "./telegram";
import { getScreenshotPath } from "./file-storage";
import type {
  CreateFeedbackInput,
  FeedbackFilterInput,
  FeedbackListResult,
  FeedbackItemDetail,
  FeedbackCommentWithAuthor,
  FeedbackStats,
} from "./types";
import type { FeedbackStatus } from "@prisma/client";

// === Rate Limiting ===

const DAILY_LIMIT = 5;
const URGENT_HOURLY_LIMIT = 1;

export async function checkFeedbackRateLimit(
  userId: string,
  isUrgent: boolean
): Promise<string | null> {
  if (!redisAvailable) return null;

  try {
    const dailyKey = `feedback:daily:${userId}`;
    const dailyCount = await redis.get(dailyKey);
    if (dailyCount && parseInt(dailyCount, 10) >= DAILY_LIMIT) {
      return "FEEDBACK_DAILY_LIMIT";
    }

    if (isUrgent) {
      const urgentKey = `feedback:urgent:${userId}`;
      const urgentCount = await redis.get(urgentKey);
      if (urgentCount && parseInt(urgentCount, 10) >= URGENT_HOURLY_LIMIT) {
        return "FEEDBACK_URGENT_LIMIT";
      }
    }

    return null;
  } catch {
    return null; // If Redis fails, allow the request
  }
}

async function incrementFeedbackCounters(
  userId: string,
  isUrgent: boolean
): Promise<void> {
  if (!redisAvailable) return;

  try {
    const dailyKey = `feedback:daily:${userId}`;
    const pipeline = redis.pipeline();
    pipeline.incr(dailyKey);
    pipeline.expire(dailyKey, 86400); // 24 hours

    if (isUrgent) {
      const urgentKey = `feedback:urgent:${userId}`;
      pipeline.incr(urgentKey);
      pipeline.expire(urgentKey, 3600); // 1 hour
    }

    await pipeline.exec();
  } catch {
    // Non-critical — don't fail the request
  }
}

// === CRUD ===

export async function createFeedback(
  userId: string,
  input: CreateFeedbackInput
): Promise<{ id: string }> {
  // Check rate limit
  const limitError = await checkFeedbackRateLimit(userId, input.isUrgent);
  if (limitError) {
    throw new RateLimitError(limitError);
  }

  // Create feedback item
  const feedback = await prisma.feedbackItem.create({
    data: {
      userId,
      type: input.type,
      description: input.description,
      pageUrl: input.pageUrl,
      isUrgent: input.isUrgent,
      screenshotPath: input.screenshotPath ?? null,
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  // Increment rate limit counters
  await incrementFeedbackCounters(userId, input.isUrgent);

  // Non-critical side effects — never fail the main request
  try {
    await logAudit(userId, "feedback.create", "FeedbackItem", feedback.id, {
      type: input.type,
      isUrgent: input.isUrgent,
    });
  } catch (err) {
    console.error("[Feedback] Failed to write audit log:", err);
  }

  if (input.isUrgent) {
    // Log + Telegram — fire-and-forget, never crash the request
    log.critical("feedback", `Срочное обращение от ${feedback.user.name || "пользователя"}`, {
      feedbackId: feedback.id,
      type: input.type,
      pageUrl: input.pageUrl,
    }).catch(() => {});

    const screenshotAbsPath = input.screenshotPath
      ? getScreenshotPath(input.screenshotPath)
      : undefined;

    sendUrgentFeedbackAlert({
      feedbackId: feedback.id,
      type: input.type,
      description: input.description,
      userName: feedback.user.name || feedback.user.email || "Пользователь",
      pageUrl: input.pageUrl,
      screenshotPath: screenshotAbsPath,
    }).catch((err) => {
      console.error("[Feedback] Failed to send TG alert:", err);
    });
  } else {
    log.info("feedback", `Новое обращение от ${feedback.user.name || "пользователя"}`, {
      feedbackId: feedback.id,
      type: input.type,
    }).catch(() => {});
  }

  return { id: feedback.id };
}

export async function listFeedback(
  userId: string,
  role: string,
  filter: FeedbackFilterInput
): Promise<FeedbackListResult> {
  const where: Record<string, unknown> = {};

  // USER sees only own feedback, SUPERADMIN sees all
  if (role !== "SUPERADMIN") {
    where.userId = userId;
  }

  if (filter.status) where.status = filter.status;
  if (filter.type) where.type = filter.type;
  if (filter.isUrgent !== undefined) where.isUrgent = filter.isUrgent;

  const [items, total] = await Promise.all([
    prisma.feedbackItem.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: [
        { isUrgent: "desc" },
        { createdAt: "desc" },
      ],
      skip: (filter.page - 1) * filter.perPage,
      take: filter.perPage,
    }),
    prisma.feedbackItem.count({ where }),
  ]);

  return {
    items,
    total,
    page: filter.page,
    perPage: filter.perPage,
  };
}

export async function getFeedbackById(
  feedbackId: string,
  userId: string,
  role: string
): Promise<FeedbackItemDetail | null> {
  const feedback = await prisma.feedbackItem.findUnique({
    where: { id: feedbackId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      comments: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!feedback) return null;

  // Access check: author or SUPERADMIN
  if (role !== "SUPERADMIN" && feedback.userId !== userId) {
    return null;
  }

  // Enrich comments with author names
  const authorIds = [...new Set(feedback.comments.map((c) => c.authorId))];
  const authors = authorIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, name: true },
      })
    : [];
  const authorMap = new Map(authors.map((a) => [a.id, a.name]));

  const commentsWithAuthors: FeedbackCommentWithAuthor[] = feedback.comments.map((c) => ({
    ...c,
    authorName: authorMap.get(c.authorId) || "Администратор",
  }));

  return {
    ...feedback,
    comments: commentsWithAuthors,
  };
}

export async function updateFeedbackStatus(
  feedbackId: string,
  status: FeedbackStatus,
  adminUserId: string
): Promise<{ id: string; status: FeedbackStatus }> {
  const feedback = await prisma.feedbackItem.findUnique({
    where: { id: feedbackId },
    select: { status: true },
  });

  if (!feedback) {
    throw new NotFoundError("Обращение не найдено");
  }

  const updated = await prisma.feedbackItem.update({
    where: { id: feedbackId },
    data: { status },
    select: { id: true, status: true, updatedAt: true },
  });

  await logAudit(adminUserId, "feedback.status_change", "FeedbackItem", feedbackId, {
    from: feedback.status,
    to: status,
  });

  return updated;
}

export async function addComment(
  feedbackId: string,
  authorId: string,
  text: string
): Promise<FeedbackCommentWithAuthor> {
  const feedback = await prisma.feedbackItem.findUnique({
    where: { id: feedbackId },
    select: { id: true },
  });

  if (!feedback) {
    throw new NotFoundError("Обращение не найдено");
  }

  const author = await prisma.user.findUnique({
    where: { id: authorId },
    select: { name: true },
  });

  const comment = await prisma.feedbackComment.create({
    data: {
      feedbackId,
      authorId,
      text,
    },
  });

  await logAudit(authorId, "feedback.comment", "FeedbackComment", comment.id, {
    feedbackId,
  });

  return {
    ...comment,
    authorName: author?.name || "Администратор",
  };
}

export async function getFeedbackStats(): Promise<FeedbackStats> {
  const [totalNew, totalUrgentNew, totalInProgress, totalResolved, totalRejected] =
    await Promise.all([
      prisma.feedbackItem.count({ where: { status: "NEW" } }),
      prisma.feedbackItem.count({ where: { status: "NEW", isUrgent: true } }),
      prisma.feedbackItem.count({ where: { status: "IN_PROGRESS" } }),
      prisma.feedbackItem.count({ where: { status: "RESOLVED" } }),
      prisma.feedbackItem.count({ where: { status: "REJECTED" } }),
    ]);

  return { totalNew, totalUrgentNew, totalInProgress, totalResolved, totalRejected };
}

// === Custom Errors ===

export class RateLimitError extends Error {
  code: string;
  constructor(code: string) {
    const messages: Record<string, string> = {
      FEEDBACK_DAILY_LIMIT: "Превышен лимит обращений (5 в сутки)",
      FEEDBACK_URGENT_LIMIT: "Не более 1 срочного обращения в час",
    };
    super(messages[code] || "Превышен лимит");
    this.code = code;
    this.name = "RateLimitError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
