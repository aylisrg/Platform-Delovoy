/**
 * OTP request answer (AC-E3.3): identical whether or not the account exists —
 * `maskedValue` masks the address the person typed.
 */
export interface LinkRequestResult {
  sent: true;
  maskedValue: string;
  expiresIn: number;
  message: string;
}

export interface LinkConfirmResult {
  linked: true;
  /** The disposable Telegram account was folded into the email account (self_link). */
  merged: boolean;
  user: {
    id: string;
    name: string | null;
    role: string;
    telegramId: string;
    /** For the Mini App token claim `sv` (ADR 2026-10-25 §Q1). */
    sessionVersion: number;
  };
  token: string;
}

export interface DeepLinkResult {
  linked: true;
  userName: string | null;
  /** The disposable Telegram account was folded into the web account (self_link). */
  merged: boolean;
}

export interface GenerateLinkResult {
  deepLink: string;
  expiresIn: number;
  expiresAt: string;
}

/**
 * Stored in Redis for 10 minutes. The code itself is never stored — only
 * `sha256(code + telegramId)`; `emailHash` keys the per-address limits.
 */
export interface OtpData {
  targetUserId: string;
  codeHash: string;
  emailHash: string;
  attempts: number;
}
