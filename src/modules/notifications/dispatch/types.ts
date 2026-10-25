import type { NotificationChannelKind } from "@prisma/client";

export type NotificationAction = {
  label: string;
  url?: string;
  callback?: string;
  /**
   * Same-origin path the tracking link `url` redirects to. Only the service
   * worker reads it — to focus the right window (admin vs Mini App) while
   * still navigating through `/r/{code}` so the click is counted.
   */
  target?: string;
};

export type NotificationPayload = {
  title: string;
  body: string;
  actions?: NotificationAction[];
  metadata?: Record<string, unknown>;
};

/**
 * Normalized delivery failure (ADR 2026-10-25 §Q3/§Q5) — human labels in
 * `delivery-labels.ts`, bot status signals from BOT_* codes.
 */
export type DeliveryFailureCode =
  | "BOT_BLOCKED"
  | "BOT_NOT_STARTED"
  | "USER_DEACTIVATED"
  | "NETWORK"
  | "CHANNEL_UNAVAILABLE"
  | "CHANNEL_EXPIRED"
  | "CHANNEL_AUTH"
  | "STALE"
  | "OTHER";

export type DeliveryResult =
  | { ok: true; externalId?: string }
  | { ok: false; reason: string; retryable: boolean; code?: DeliveryFailureCode };

export type VerificationChallenge = {
  method: "code" | "link";
  hint: string;
  expiresAt: Date;
};

export interface INotificationChannel {
  readonly kind: NotificationChannelKind;
  isAvailable(): boolean;
  send(address: string, payload: NotificationPayload): Promise<DeliveryResult>;
  verify?(address: string): Promise<VerificationChallenge>;
  confirmVerification?(address: string, code: string): Promise<boolean>;
}

export type DispatchEvent = {
  userId: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  payload: NotificationPayload;
  /** Bypass dedup window (eg. for retry) */
  forceFresh?: boolean;
};

export type DispatchOutcome =
  | { status: "queued"; outgoingId: string; scheduledFor: Date }
  | { status: "deferred"; outgoingId: string; scheduledFor: Date }
  | { status: "skipped"; reason: string };
