/**
 * Auth-event audit helper.
 *
 * Wave 2 of the auth refactor (ADR 2026-04-27 §6) introduces 8 canonical
 * `auth.*` events that land in `AuditLog` so we can finally measure
 * sign-in funnel and detect anomalies.
 *
 * The base `logAudit()` in `src/lib/logger.ts` is the generic primitive.
 * This module wraps it with:
 *   - typed action enum so call sites can't typo the action name;
 *   - centralised IP hashing (sha256 → first 16 chars) to keep raw IPs
 *     out of the AuditLog table while preserving correlation;
 *   - chatId masking so Telegram chat IDs never leak in plaintext.
 *
 * userAgent is intentionally NOT collected — owner explicitly opted out
 * of UA storage to keep the table PII-light.
 */
import crypto from "crypto";
import { prisma } from "./db";

export type AuthAuditAction =
  | "auth.signin.attempt"
  | "auth.signin.success"
  | "auth.signin.failure"
  | "auth.signout"
  | "auth.merge.auto"
  | "auth.merge.manual"
  | "auth.merge.conflict"
  | "auth.merge.skipped_admin";

export type AuthAuditMetadata = {
  /** Provider id, e.g. "telegram-token" / "magic-link" / "credentials" */
  provider?: string;
  /** "deeplink" | "widget" | "form" — disambiguates inside one provider */
  method?: string;
  /** Hashed IP — produced by `hashIp()`, never raw */
  ipHash?: string;
  /** Was this a brand-new account? */
  isNewUser?: boolean;
  /** Match key used for merge — "phone" / "email" / "telegramId" / "vkId" */
  matchedBy?: string;
  /** Candidate user ids for merge.conflict */
  candidateUserIds?: string[];
  /** For merge.manual — counts of FK rows transferred */
  fkMoved?: Record<string, number>;
  /** For merge.* — secondary user that was tombstoned / would be merged */
  secondaryUserId?: string;
  /** For signin.failure — why */
  reason?: string;
  /** For Telegram bot — masked chat id (last 4 visible) */
  chatIdMasked?: string;
  /** For skipped_admin — what role triggered the skip */
  role?: string;
  /** For merge.* — extra free-form fields */
  [key: string]: unknown;
};

/**
 * Hash a raw IP into an opaque, short, stable token. Used for funnel
 * metrics ("how many distinct IPs attempted login today") without
 * persisting raw IPs that would be PII.
 */
export function hashIp(ip: string | null | undefined): string | undefined {
  if (!ip || typeof ip !== "string") return undefined;
  const trimmed = ip.trim();
  if (trimmed.length === 0) return undefined;
  return crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
}

/**
 * Mask a Telegram chat id so only the last 4 digits remain visible.
 * "1234567890" → "******7890". Negative chat ids (groups) keep the
 * leading minus.
 */
export function maskChatId(chatId: string | number | null | undefined): string | undefined {
  if (chatId === null || chatId === undefined) return undefined;
  const s = String(chatId);
  if (s.length === 0) return undefined;
  const negative = s.startsWith("-");
  const digits = negative ? s.slice(1) : s;
  if (digits.length <= 4) return s; // too short to mask meaningfully
  const masked = "*".repeat(digits.length - 4) + digits.slice(-4);
  return negative ? `-${masked}` : masked;
}

/**
 * Write an `auth.*` audit row. Best-effort: errors are logged to console
 * but never thrown — auth flow must keep working even if AuditLog write
 * fails (e.g. transient DB hiccup).
 *
 * `userId` may be undefined for anonymous attempts (e.g. signin.attempt
 * before we know who the user is). When undefined, the row is skipped —
 * AuditLog.userId is non-null by schema, and using a sentinel "anonymous"
 * id would conflict with the FK to User. Anonymous funnel events are
 * better captured in SystemEvent INFO instead.
 */
export async function logAuthEvent(
  action: AuthAuditAction,
  userId: string | null | undefined,
  metadata: AuthAuditMetadata = {}
): Promise<void> {
  if (!userId) {
    // Anonymous events go to console for now (visible in Vercel logs).
    // The funnel "attempt → success" requires a user id either way (the
    // attempt for known users, the success for new users).
    if (process.env.NODE_ENV !== "test") {
      console.info(`[Auth] ${action} (anonymous)`, metadata);
    }
    return;
  }

  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entity: "User",
        entityId: userId,
        metadata: JSON.parse(JSON.stringify(metadata)),
      },
    });
  } catch (err) {
    console.error(`[Auth] Failed to write ${action} for ${userId}`, err);
  }
}
