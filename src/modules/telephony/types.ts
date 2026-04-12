import type { CallDirection, CallStatus } from "@prisma/client";

export type { CallDirection, CallStatus };

export interface CallLogRecord {
  id: string;
  bookingId: string | null;
  moduleSlug: string | null;
  direction: CallDirection;
  status: CallStatus;
  clientPhone: string;
  managerPhone: string | null;
  initiatedBy: string | null;
  externalCallId: string | null;
  duration: number | null;
  recordingUrl: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CallLogWithManager extends CallLogRecord {
  initiatedByName?: string | null;
}

export interface TelephonyModuleConfig {
  enabled: boolean;
  publicPhone: string;
  displayPhone: string;
  sipLine: string;
  callerId?: string;
  recordCalls?: boolean;
}

export interface NovofonWebhookPayload {
  event: string;
  call_id: string;
  direction?: "inbound" | "outbound";
  duration?: number;
  recording_url?: string;
  caller?: string;
  callee?: string;
  [key: string]: unknown;
}
