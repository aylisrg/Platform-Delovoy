/**
 * POST /api/avito/webhook/calls — Avito Call Tracking webhook.
 *
 * Public endpoint. Authenticated via secret token in the `?token=…` query
 * string (constant-time compare against `AvitoIntegration.webhookSecret`).
 *
 * Contract — ADR section 2.7:
 *   • Respond 200 OK in all paths (including invalid token, parsing
 *     errors, rate-limit hits). Avito treats non-2xx as failure and
 *     storms retries.
 *   • Idempotent persistence — UNIQUE constraint on `AvitoCallEvent.avitoCallId`.
 *   • Rate limit: 10 req/sec sliding window per source IP, key
 *     `avito:webhook:calls:{ip}`. Excess → 200 OK + WARNING.
 */

import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";
import {
  AvitoCallWebhookSchema,
  processCallWebhook,
} from "@/lib/avito/calls";
import { verifyAvitoWebhookToken } from "@/lib/avito/webhook-security";

export const dynamic = "force-dynamic";

// 10 requests per 1 second per IP — sliding window.
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 1000;

export async function POST(request: NextRequest) {
  const ip = clientIp(request);

  // 1. Rate limit. Failures here MUST NOT propagate — webhook always 200 OK.
  const limited = await isRateLimited(ip).catch(() => false);
  if (limited) {
    await safeLogSystemEvent({
      level: "WARNING",
      source: "avito.webhook.calls",
      message: "Rate limit hit on calls webhook",
      metadata: { ip },
    });
    return apiResponse({ accepted: false, reason: "rate_limited" });
  }

  // 2. Token validation. Always 200 OK, even on failure (ADR section 5).
  const token = request.nextUrl.searchParams.get("token");
  const tokenCheck = await verifyAvitoWebhookToken(token);
  if (!tokenCheck.ok) {
    await safeLogSystemEvent({
      level: "WARNING",
      source: "avito.webhook.calls",
      message: `Webhook token check failed: ${tokenCheck.reason}`,
      metadata: { ip, reason: tokenCheck.reason },
    });
    return apiResponse({ accepted: false, reason: "auth" });
  }

  // 3. Body parse — JSON.parse failures are non-fatal.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await safeLogSystemEvent({
      level: "WARNING",
      source: "avito.webhook.calls",
      message: "Webhook body is not valid JSON",
      metadata: { ip },
    });
    return apiResponse({ accepted: false, reason: "bad_json" });
  }

  // 4. Schema validation.
  const parsed = AvitoCallWebhookSchema.safeParse(body);
  if (!parsed.success) {
    await safeLogSystemEvent({
      level: "WARNING",
      source: "avito.webhook.calls",
      message: "Webhook payload failed schema validation",
      metadata: {
        ip,
        issues: parsed.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join("."),
          code: i.code,
        })),
      },
    });
    return apiResponse({ accepted: false, reason: "invalid_payload" });
  }

  // 5. Process — idempotency is enforced inside via UNIQUE constraint.
  try {
    const result = await processCallWebhook(parsed.data);
    return apiResponse({
      accepted: true,
      created: result.created,
      taskCreated: result.taskCreated,
    });
  } catch (err) {
    await safeLogSystemEvent({
      level: "ERROR",
      source: "avito.webhook.calls",
      message: "Unhandled error while processing calls webhook",
      metadata: {
        ip,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    // Still 200 OK — Avito should not keep retrying on our internal errors.
    return apiResponse({ accepted: false, reason: "internal_error" });
  }
}

// === helpers =========================================================

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/**
 * Sliding-window limiter: at most RATE_LIMIT_MAX requests per
 * RATE_LIMIT_WINDOW_MS milliseconds per source IP.
 *
 * Returns false (i.e. allow) if Redis is unavailable — webhooks must
 * still flow if our cache is down.
 */
async function isRateLimited(ip: string): Promise<boolean> {
  if (!redisAvailable) return false;
  const key = `avito:webhook:calls:${ip}`;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, `${now}:${Math.random()}`);
    pipeline.zcard(key);
    pipeline.pexpire(key, RATE_LIMIT_WINDOW_MS * 5);
    const results = await pipeline.exec();
    const count = (results?.[2]?.[1] as number) ?? 0;
    return count > RATE_LIMIT_MAX;
  } catch {
    return false;
  }
}

async function safeLogSystemEvent(input: {
  level: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.systemEvent.create({
      data: {
        level: input.level,
        source: input.source,
        message: input.message,
        metadata: (input.metadata ?? {}) as object,
      },
    });
  } catch {
    /* logging must never fail the webhook */
  }
}
