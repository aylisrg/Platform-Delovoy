/**
 * Owner-decisions — infrastructure-only модуль (прецедент pipeline-metrics):
 * решения владельца по автоочереди, принимаемые кнопками в Telegram.
 * Не бизнес-модуль: без health-роута и публичного API; PRD не требуется.
 *
 * Контур (ADR 2026-08-20-owner-out-of-github):
 *   свипер (Actions) —POST→ сайт —Telegram-кнопки→ владелец —callback→ бот
 *   —POST→ сайт (решение в БД) ←GET/PATCH— свипер (исполнение в GitHub).
 * GitHub-креды есть ТОЛЬКО у Actions; сайт и бот лишь хранят решение.
 */

export const DECISION_KINDS = ['merge-hold', 'blocked-question', 'owner-idea', 'pat-rotation'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export const DECISION_ACTIONS = ['approve', 'reject', 'defer', 'cancel'] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

/** Префикс callback_data кнопок в Telegram: `ownerdec:<id>:<action>`. */
export const DECISION_CALLBACK_PREFIX = 'ownerdec';

export interface DecisionPayload {
  /** merge-hold: причины гейта. */
  reasons?: string[];
  url?: string;
  /** blocked-question (prod-apply): ops-workflow, который диспатчит свипер после «да». */
  dispatchWorkflow?: string;
  dispatchInputs?: Record<string, string>;
  /** owner-idea: свободный текст идеи. */
  text?: string;
  /** pat-rotation: пошаговая инструкция. */
  instructions?: string;
}

export interface CreateDecisionInput {
  kind: DecisionKind;
  subjectType: 'pr' | 'issue' | 'none';
  subjectNumber: number | null;
  headSha: string | null;
  title: string;
  payload?: DecisionPayload | null;
}

export interface DecisionView {
  id: string;
  kind: string;
  subjectType: string;
  subjectNumber: number | null;
  headSha: string | null;
  title: string;
  payload: DecisionPayload | null;
  status: string;
  decision: string | null;
  note: string | null;
  decidedAt: string | null;
  createdAt: string;
}
