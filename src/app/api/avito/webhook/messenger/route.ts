import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";
import { verifyWebhookToken } from "@/lib/avito/webhook-security";
import { parseInboundWebhook, sendMessage } from "@/lib/avito/messenger";
import {
  routeInboundMessage,
  type RouteInboundResult,
} from "@/lib/avito/lead-routing";
import { dispatch } from "@/modules/notifications/dispatch/dispatcher";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * POST /api/avito/webhook/messenger?token=<secret>
 *
 * Public endpoint hit by Avito for every inbound Messenger event.
 *
 * Contract (ADR §2.6, §5):
 *  - ALWAYS responds with HTTP 200, even on failure — Avito does not retry
 *    politely. Errors are logged into SystemEvent for SUPERADMIN review.
 *  - Token is verified in constant-time against AvitoIntegration.webhookSecret.
 *  - Idempotent via UNIQUE on AvitoMessage.avitoMessageId.
 *  - Rate limited at 10 req/sec per source IP via Redis sliding window.
 *  - Auto-reply is sent SYNCHRONOUSLY (not via dispatch()) to satisfy the
 *    60-second SLA (US-2.3) — quiet-hours rules don't apply to buyer chats.
 *
 * The `Module.config.avito.autoReplyEnabled` toggle gates the auto-reply.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  // Token check — invalid token returns 200 OK (don't help brute-force) but
  // logs WARNING.
  let valid = false;
  try {
    valid = await verifyWebhookToken(token);
  } catch (err) {
    await logSystemEvent("WARNING", "avito.webhook.security_check_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return ok();
  }
  if (!valid) {
    await logSystemEvent("WARNING", "avito.webhook.invalid_token", {
      ip: extractIp(request),
    });
    return ok();
  }

  // Per-IP rate limit — exceedance is logged WARNING but still returns 200 OK.
  const ip = extractIp(request);
  const overLimit = await checkIpRateLimit(ip);
  if (overLimit) {
    await logSystemEvent("WARNING", "avito.webhook.rate_limited", { ip });
    return ok();
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    await logSystemEvent("WARNING", "avito.webhook.invalid_json", { ip });
    return ok();
  }

  const parsed = parseInboundWebhook(rawBody);
  if (!parsed) {
    await logSystemEvent("WARNING", "avito.webhook.parse_failed", {
      ip,
      sample: safeSample(rawBody),
    });
    return ok();
  }

  let result: RouteInboundResult;
  try {
    result = await routeInboundMessage({
      avitoMessageId: parsed.avitoMessageId,
      avitoChatId: parsed.avitoChatId,
      avitoItemId: parsed.avitoItemId,
      authorAvitoUserId: parsed.authorAvitoUserId ?? "unknown",
      authorName: null,
      body: parsed.body,
      receivedAt: parsed.receivedAt,
      rawPayload: rawBody,
    });
  } catch (err) {
    await logSystemEvent("ERROR", "avito.webhook.routing_failed", {
      err: err instanceof Error ? err.message : String(err),
      avitoMessageId: parsed.avitoMessageId,
    });
    return ok();
  }

  if (result.idempotent) return ok();

  // Auto-reply (only on freshly-created tasks — first inbound message).
  if (result.autoReplyEligible) {
    await maybeSendAutoReply({
      moduleSlug: result.moduleSlug,
      chatId: parsed.avitoChatId,
      itemId: parsed.avitoItemId,
      taskId: result.task.id,
    });
  }

  // Notify the responsible manager(s) via dispatch (Telegram by default).
  void dispatchLeadNotification({
    taskId: result.task.id,
    moduleSlug: result.moduleSlug,
    publicId: result.task.publicId,
    title: result.task.title,
    body: parsed.body,
    reopened: result.reopened,
    created: result.created,
  }).catch(() => undefined);

  return ok();
}

// -- helpers ---------------------------------------------------------------

function ok(): NextResponse {
  return NextResponse.json({ success: true }, { status: 200 });
}

function extractIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "unknown";
  const realIp = request.headers.get("x-real-ip");
  return realIp ?? "unknown";
}

async function checkIpRateLimit(ip: string): Promise<boolean> {
  if (!redisAvailable) return false;
  const key = `avito:webhook:msg:${ip}`;
  const limit = 10;
  const windowSec = 1;
  const now = Date.now();
  const windowStart = now - windowSec * 1000;
  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, `${now}:${Math.random()}`);
    pipeline.zcard(key);
    pipeline.expire(key, windowSec + 1);
    const results = await pipeline.exec();
    const count = results?.[2]?.[1] as number | undefined;
    return typeof count === "number" && count > limit;
  } catch {
    return false;
  }
}

async function logSystemEvent(
  level: "INFO" | "WARNING" | "ERROR" | "CRITICAL",
  message: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.systemEvent.create({
      data: {
        level,
        source: "avito.webhook",
        message,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Don't fail the webhook on logging failure.
  }
}

function safeSample(rawBody: unknown): string {
  try {
    return JSON.stringify(rawBody).slice(0, 500);
  } catch {
    return "<unserializable>";
  }
}

type AutoReplyInput = {
  moduleSlug: string | null;
  chatId: string;
  itemId: string | null;
  taskId: string;
};

async function maybeSendAutoReply(input: AutoReplyInput): Promise<void> {
  if (!input.moduleSlug) return;
  try {
    const moduleRow = await prisma.module.findUnique({
      where: { slug: input.moduleSlug },
      select: { name: true, config: true },
    });
    if (!moduleRow) return;
    const cfg = parseAvitoConfig(moduleRow.config);
    if (!cfg.autoReplyEnabled) return;

    const text = renderAutoReply(cfg.autoReplyText, {
      moduleName: moduleRow.name,
      bookingUrl: bookingUrlForModule(input.moduleSlug),
    });

    const result = await sendMessage({
      chatId: input.chatId,
      itemId: input.itemId ?? undefined,
      text,
    });

    if (result.ok) {
      await prisma.avitoMessage.create({
        data: {
          avitoMessageId:
            result.externalId ?? `auto-reply:${input.taskId}:${Date.now()}`,
          avitoChatId: input.chatId,
          direction: "OUTBOUND",
          authorName: "auto-reply",
          body: text,
          receivedAt: new Date(),
          taskId: input.taskId,
        },
      });
      await prisma.taskEvent.create({
        data: {
          taskId: input.taskId,
          kind: "COMMENT_ADDED",
          metadata: {
            source: "avito",
            avitoSent: true,
            kind: "auto-reply",
            avitoChatId: input.chatId,
          },
        },
      });
    } else {
      await logSystemEvent("WARNING", "avito.auto_reply.failed", {
        reason: result.reason,
        chatId: input.chatId,
      });
    }
  } catch (err) {
    await logSystemEvent("ERROR", "avito.auto_reply.error", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

const DEFAULT_AUTO_REPLY =
  "Здравствуйте! Спасибо за обращение. Мы ответим в ближайшее время. Забронировать сразу: {bookingUrl}";

type AvitoModuleConfig = {
  autoReplyEnabled: boolean;
  autoReplyText: string;
};

function parseAvitoConfig(raw: Prisma.JsonValue | null): AvitoModuleConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { autoReplyEnabled: false, autoReplyText: DEFAULT_AUTO_REPLY };
  }
  const root = raw as Record<string, unknown>;
  const avito =
    root.avito && typeof root.avito === "object" && !Array.isArray(root.avito)
      ? (root.avito as Record<string, unknown>)
      : {};
  return {
    autoReplyEnabled: avito.autoReplyEnabled === true,
    autoReplyText:
      typeof avito.autoReplyText === "string" && avito.autoReplyText.trim()
        ? (avito.autoReplyText as string)
        : DEFAULT_AUTO_REPLY,
  };
}

function renderAutoReply(
  template: string,
  vars: { moduleName: string; bookingUrl: string }
): string {
  return template
    .replaceAll("{bookingUrl}", vars.bookingUrl)
    .replaceAll("{moduleName}", vars.moduleName);
}

function bookingUrlForModule(moduleSlug: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://delovoy-park.ru";
  switch (moduleSlug) {
    case "gazebos":
      return `${base}/gazebos`;
    case "ps-park":
      return `${base}/ps-park`;
    default:
      return base;
  }
}

type LeadNotifyInput = {
  taskId: string;
  publicId: string;
  moduleSlug: string | null;
  title: string;
  body: string;
  reopened: boolean;
  created: boolean;
};

async function dispatchLeadNotification(input: LeadNotifyInput): Promise<void> {
  if (!input.created && !input.reopened) return; // existing chat — no extra noise

  // Resolve recipients: SUPERADMINs + MANAGERs assigned to the moduleSlug.
  const recipients = await resolveLeadRecipients(input.moduleSlug);
  if (recipients.length === 0) return;

  const eventType = "avito.lead.new";
  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/admin/tasks/${input.publicId}`;
  await Promise.all(
    recipients.map((userId) =>
      dispatch({
        userId,
        eventType,
        entityType: "Task",
        entityId: input.taskId,
        payload: {
          title: `Новый лид с Авито (${input.publicId})`,
          body: `${input.title}\n\n${input.body.slice(0, 240)}`,
          actions: [{ label: "Открыть задачу", url }],
        },
      }).catch(() => undefined)
    )
  );
}

async function resolveLeadRecipients(
  moduleSlug: string | null
): Promise<string[]> {
  const supers = await prisma.user.findMany({
    where: { role: "SUPERADMIN" },
    select: { id: true },
  });
  const out = new Set<string>(supers.map((u) => u.id));

  if (moduleSlug) {
    const managers = await prisma.moduleAssignment.findMany({
      where: {
        module: { slug: moduleSlug, isActive: true },
        user: { role: { in: ["MANAGER", "ADMIN"] } },
      },
      select: { userId: true },
    });
    for (const m of managers) out.add(m.userId);
  }
  return Array.from(out);
}
