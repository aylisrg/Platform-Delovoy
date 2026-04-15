import type { FeedbackItem, FeedbackComment, FeedbackType, FeedbackStatus, User } from "@prisma/client";

// === Input Types ===

export type CreateFeedbackInput = {
  type: FeedbackType;
  description: string;
  pageUrl: string;
  isUrgent: boolean;
  screenshotPath?: string;
};

export type FeedbackFilterInput = {
  page: number;
  perPage: number;
  status?: FeedbackStatus;
  type?: FeedbackType;
  isUrgent?: boolean;
};

export type UpdateFeedbackStatusInput = {
  status: FeedbackStatus;
};

export type CreateCommentInput = {
  text: string;
};

// === Output Types ===

export type FeedbackItemWithUser = FeedbackItem & {
  user: Pick<User, "id" | "name" | "email">;
};

export type FeedbackItemDetail = FeedbackItem & {
  user: Pick<User, "id" | "name" | "email">;
  comments: FeedbackCommentWithAuthor[];
};

export type FeedbackCommentWithAuthor = FeedbackComment & {
  authorName?: string;
};

export type FeedbackStats = {
  totalNew: number;
  totalUrgentNew: number;
  totalInProgress: number;
  totalResolved: number;
  totalRejected: number;
};

export type FeedbackListResult = {
  items: FeedbackItemWithUser[];
  total: number;
  page: number;
  perPage: number;
};
