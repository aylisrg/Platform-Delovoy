import { z } from "zod";

/**
 * Zod contracts of the SUPERADMIN merge API (ADR 2026-10-25 §6.2):
 * `/api/users/merge/search`, `/api/users/merge/preview`, `/api/users/merge`,
 * `/api/users/merge-requests`, `/api/users/merge-requests/[id]`.
 */

export const SAME_ACCOUNT_MESSAGE = "Нельзя объединить аккаунт сам с собой";

export const mergeSearchQuerySchema = z.object({
  q: z.string().trim().min(2, "Введите минимум 2 символа").max(100),
  exclude: z.string().max(64).optional(),
});

export const mergePairSchema = z
  .object({
    primaryId: z.string().min(1).max(64),
    secondaryId: z.string().min(1).max(64),
  })
  .refine((d) => d.primaryId !== d.secondaryId, { message: SAME_ACCOUNT_MESSAGE });

export const mergeExecuteSchema = mergePairSchema.and(
  z.object({
    confirmIrreversible: z.literal(true, { message: "Подтвердите, что действие нельзя отменить" }),
    confirmTelegramConflict: z.boolean().optional(),
  }),
);

export const mergeRequestsQuerySchema = z.object({
  userId: z.string().max(64).optional(),
});

export const mergeRequestActionSchema = z.object({ action: z.literal("dismiss") }).strict();

export const mergeRequestIdParamSchema = z.string().min(1).max(64);

export type MergeSearchQuery = z.infer<typeof mergeSearchQuerySchema>;
export type MergePairInput = z.infer<typeof mergePairSchema>;
export type MergeExecuteInput = z.infer<typeof mergeExecuteSchema>;
export type MergeRequestsQuery = z.infer<typeof mergeRequestsQuerySchema>;
