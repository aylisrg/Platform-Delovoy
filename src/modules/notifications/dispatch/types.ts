import type { NotificationChannelKind } from "@prisma/client";

export type NotificationAction = {
  label: string;
  url?: string;
  callback?: string;
};

export type NotificationPayload = {
  title: string;
  body: string;
  actions?: NotificationAction[];
  metadata?: Record<string, unknown>;
};

export type DeliveryResult =
  | { ok: true; externalId?: string }
  | { ok: false; reason: string; retryable: boolean };

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
