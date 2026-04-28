/**
 * Avito webhook security helpers.
 *
 * NOTE — coordination with PR-2 (Messenger): PR-2 also creates this file as
 * part of the Messenger webhook. Both PRs implement the same primitive
 * (constant-time secret compare against `AvitoIntegration.webhookSecret`).
 * If both PRs end up creating the file, the merge-coordinator should keep
 * this single canonical version — there is no per-PR divergence.
 *
 * See ADR section 5: webhook security & idempotency.
 */

import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export type WebhookTokenCheck =
  | { ok: true }
  | { ok: false; reason: "MISSING_TOKEN" | "NOT_CONFIGURED" | "INVALID_TOKEN" };

/**
 * Constant-time comparison of a webhook secret token against the value
 * stored in `AvitoIntegration.webhookSecret`.
 *
 * Returns `{ ok: false, reason }` for all failure paths so callers can
 * still respond with 200 OK (Avito treats non-2xx as failure and storms
 * with retries — see ADR section 2.6/2.7).
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

/**
 * Constant-time string equality. Pads the shorter buffer to avoid leaking
 * length through a thrown exception from `timingSafeEqual` (which requires
 * equal-length buffers).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Still do a comparison so timing doesn't differ wildly between the
    // length-mismatch and length-match branches.
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
