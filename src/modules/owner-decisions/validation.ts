import { z } from 'zod';
import { DECISION_ACTIONS, DECISION_KINDS } from './types';

/** POST /api/admin/owner-decisions — запрос решения от свипера (Actions). */
export const createDecisionSchema = z.object({
  kind: z.enum(DECISION_KINDS),
  subjectType: z.enum(['pr', 'issue', 'none']),
  subjectNumber: z.number().int().positive().nullable().default(null),
  headSha: z.string().regex(/^[0-9a-f]{7,64}$/i).nullable().default(null),
  title: z.string().min(1).max(300),
  payload: z
    .object({
      reasons: z.array(z.string().max(500)).max(20).optional(),
      url: z.string().url().optional(),
      dispatchWorkflow: z.string().regex(/^[\w.-]+\.yml$/).optional(),
      dispatchInputs: z.record(z.string(), z.string().max(500)).optional(),
      text: z.string().max(4000).optional(),
      instructions: z.string().max(2000).optional(),
    })
    .nullable()
    .optional(),
});

/** GET /api/admin/owner-decisions?status=… */
export const listDecisionsSchema = z.object({
  status: z.enum(['decided', 'pending', 'all']).default('decided'),
});

/** PATCH /api/admin/owner-decisions — отчёт исполнения от свипера. */
export const executorPatchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['EXECUTED', 'EXPIRED']),
  executorNote: z.string().max(2000).optional(),
});

/** POST /api/bot/owner-decisions — решение/идея/заметка из бота. */
export const botDecisionSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('decide'),
    decisionId: z.string().min(1),
    action: z.enum(DECISION_ACTIONS),
    note: z.string().max(2000).optional(),
    telegramUserId: z.string().min(1),
  }),
  z.object({
    op: z.literal('idea'),
    text: z.string().min(3).max(4000),
    telegramUserId: z.string().min(1),
  }),
  z.object({
    op: z.literal('note'),
    telegramMessageId: z.string().min(1),
    text: z.string().min(1).max(2000),
    telegramUserId: z.string().min(1),
  }),
  z.object({
    op: z.literal('list'),
    telegramUserId: z.string().min(1),
  }),
]);
