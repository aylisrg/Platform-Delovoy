export type TelephonyPeriod = "today" | "7d" | "30d";
export type TelephonyCallFilter = "all" | "inbound" | "answered" | "missed" | "outbound";
export type TelephonyCallOutcome = "answered" | "missed" | "outbound" | "pending";

export interface TelephonyDayStats {
  date: string;
  total: number;
  inbound: number;
  answered: number;
  missed: number;
  outbound: number;
  pending: number;
}

export interface TelephonyJournalCall {
  id: string;
  startedAt: string;
  direction: "INBOUND" | "OUTBOUND";
  outcome: TelephonyCallOutcome;
  maskedPhone: string | null;
  employeeName: string | null;
  talkDuration: number | null;
  waitDuration: number | null;
  isLost: boolean;
}

export interface TelephonyDashboard {
  period: TelephonyPeriod;
  dateFrom: string;
  dateTo: string;
  timeZone: "Europe/Moscow";
  summary: Omit<TelephonyDayStats, "date"> & {
    /** Answered / (answered + missed), 0..100; null without known inbound outcomes. */
    answerRate: number | null;
    /** Mean of positive talk durations across inbound and outbound calls. */
    avgTalkSeconds: number | null;
  };
  daily: TelephonyDayStats[];
  calls: TelephonyJournalCall[];
  pagination: { page: number; perPage: number; total: number; totalPages: number };
  source: {
    dataApiConfigured: boolean;
    webhookConfigured: boolean;
    lastCallAt: string | null;
    /** Latest stored journal row update, not a successful sync heartbeat. */
    lastJournalUpdate: string | null;
  };
}
