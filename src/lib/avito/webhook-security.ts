/**
 * Avito webhook security helpers.
 *
 * Strategy:
 *  - Secret token in URL query param `?token=...`, generated as 64 hex chars
 *    by `crypto.randomBytes(32)` and stored in `AvitoIntegration.webhookSecret`.
 *  - Constant-time compare via `crypto.timingSafeEqual` to prevent timing
 *    side-channel leaks of the secret.
 *  - HMAC support is not yet documented by Avito Pro for our tier — when /if
 *    they roll it out, this is the place to add `verifyHmac()`.
 *
 * Two public verification helpers exist for compatibility with both PR-2
 * (Messenger) and PR-3/PR-4 (Reviews/Calls) callsites:
 *
 *   - `verifyWebhookToken(token)`         → boolean   (PR-2 messenger route)
 *   - `verifyAvitoWebhookToken(token)`    → structured WebhookTokenCheck (PR-4 calls route)
 *
 * Both load the same `AvitoIntegration.webhookSecret` and use the same
 * constant-time compare under the hood — they differ only in the return
 * shape required by the calling route.
 *
 * See ADR §5: docs/architecture/2026-04-28-delovoy-avito-adr.md
 */

import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export type WebhookTokenCheck =
  | { ok: true }
  | { ok: false; reason: "MISSING_TOKEN" | "NOT_CONFIGURED" | "INVALID_TOKEN" };

/**
 * Constant-time compare of `provided` (untrusted) against `expected` (DB-loaded).
 * Returns `false` for any of: empty input, length mismatch, byte mismatch.
 *
 * Both arguments are coerced to UTF-8 buffers; comparison is byte-wise.
 */
export function constantTimeCompare(provided: string, expected: string): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (provided.length === 0 || expected.length === 0) return false;
  if (provided.length !== expected.length) return false;

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;

  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Constant-time string equality. Pads the shorter buffer to avoid leaking
 * length through a thrown exception from `timingSafeEqual` (which requires
 * equal-length buffers). Difference vs `constantTimeCompare`: this version
 * always performs a buffer compare even on length mismatch (slightly more
 * timing-uniform), and is used by `verifyAvitoWebhookToken`.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    const max = Math.max(aBuf.length, bBuf.length);
    const pa = Buffer.alloc(max);
    const pb = Buffer.alloc(max);
    aBuf.copy(pa);
    bBuf.copy(pb);
    timingSafeEqual(pa, pb);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Verify the `?token=...` from an incoming Avito webhook request against
 * the stored `AvitoIntegration.webhookSecret`. If the integration row or
 * secret is missing — return `false` (no setup yet).
 *
 * Used by the Messenger webhook (PR-2). For routes that need to differentiate
 * "missing token" vs "not configured" vs "invalid token" — use
 * `verifyAvitoWebhookToken` instead.
 */
export async function verifyWebhookToken(provided: string | null): Promise<boolean> {
  if (!provided) return false;
  const integration = await prisma.avitoIntegration.findUnique({
    where: { id: "default" },
    select: { webhookSecret: true },
  });
  if (!integration?.webhookSecret) return false;
  return constantTimeCompare(provided, integration.webhookSecret);
}

/**
 * Structured-result counterpart of `verifyWebhookToken`. Returns
 * `{ ok: false, reason }` for all failure paths so callers can still
 * respond with 200 OK (Avito treats non-2xx as failure and storms with
 * retries — see ADR section 2.6/2.7).
 *
 *   - `MISSING_TOKEN`     — caller did not pass `?token=…`.
 *   - `NOT_CONFIGURED`    — the AvitoIntegration row has no webhook secret.
 *   - `INVALID_TOKEN`     — provided token does not match.
 */
export async function verifyAvitoWebhookToken(
  providedToken: string | null | undefined
): Promise<WebhookTokenCheck> {
  if (!providedToken) {
    return { ok: false, reason: "MISSING_TOKEN" };
  }

  const integration = await prisma.avitoIntegration.findUnique({
    where: { id: "default" },
    select: { webhookSecret: true },
  });
  const stored = integration?.webhookSecret;
  if (!stored) {
    return { ok: false, reason: "NOT_CONFIGURED" };
  }

  if (!constantTimeEquals(providedToken, stored)) {
    return { ok: false, reason: "INVALID_TOKEN" };
  }
  return { ok: true };
}
