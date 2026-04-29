import { prisma } from "@/lib/db";
import { log, logAudit } from "@/lib/logger";
import { novofonStartCall, novofonCheckStatus } from "./novofon-client";
import type { TelephonyModuleConfig, CallLogWithManager, NovofonWebhookPayload } from "./types";
import type { CallFilter } from "./validation";

// === CONFIG HELPERS ===

/**
 * Read telephony config from Module.config for a given slug.
 * Returns null if telephony is disabled or config not set.
 */
export async function getTelephonyConfig(
  moduleSlug: string
): Promise<TelephonyModuleConfig | null> {
  const dbModule = await prisma.module.findUnique({
    where: { slug: moduleSlug },
    select: { config: true, isActive: true },
  });

  if (!dbModule?.isActive) return null;

  const config = dbModule.config as Record<string, unknown> | null;
  const telephony = config?.telephony as Partial<TelephonyModuleConfig> | undefined;

  if (!telephony?.enabled) return null;

  return {
    enabled: true,
    publicPhone: telephony.publicPhone ?? "",
    displayPhone: telephony.displayPhone ?? telephony.publicPhone ?? "",
    sipLine: telephony.sipLine ?? "",
    callerId: telephony.callerId,
    recordCalls: telephony.recordCalls ?? false,
  };
}

/**
 * Get the shared public phone number (same for gazebos and ps-park).
 * Returns the phone from either module config or falls back to the other.
 */
export async function getPublicPhone(
  moduleSlug: string
): Promise<{ phone: string; displayPhone: string } | null> {
  const config = await getTelephonyConfig(moduleSlug);
  if (!config?.publicPhone) return null;
  return {
    phone: config.publicPhone,
    displayPhone: config.displayPhone || config.publicPhone,
  };
}

// === OUTBOUND CALLS ===

/**
 * Initiate an outbound click-to-call from manager to client.
 * Sequence:
 *   1. Load booking + client phone
 *   2. Load module telephony config + SIP line
 *   3. Create CallLog (INITIATED)
 *   4. Call Novofon API
 *   5. Update CallLog (RINGING or FAILED)
 *   6. Log audit + system event
 */
export async function initiateCall(
  managerId: string,
  bookingId: string,
  moduleSlug: string
) {
  // 1. Load booking
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, moduleSlug },
    select: { id: true, clientPhone: true, moduleSlug: true },
  });

  if (!booking) {
    throw new TelephonyError("BOOKING_NOT_FOUND", "Бронирование не найдено");
  }

  if (!booking.clientPhone) {
    throw new TelephonyError(
      "NO_CLIENT_PHONE",
      "У клиента не указан номер телефона"
    );
  }

  // 2. Load config
  const config = await getTelephonyConfig(moduleSlug);
  if (!config) {
    throw new TelephonyError(
      "TELEPHONY_DISABLED",
      "Телефония отключена для этого модуля"
    );
  }

  const apiKey = process.env.NOVOFON_API_KEY;
  if (!apiKey) {
    throw new TelephonyError(
      "TELEPHONY_NOT_CONFIGURED",
      "API ключ Novofon не настроен"
    );
  }

  // 3. Create CallLog (INITIATED)
  const callLog = await prisma.callLog.create({
    data: {
      bookingId,
      moduleSlug,
      direction: "OUTBOUND",
      status: "INITIATED",
      clientPhone: booking.clientPhone,
      managerPhone: config.sipLine,
      initiatedBy: managerId,
    },
  });

  // 4. Call Novofon API
  const novofonResult = await novofonStartCall(apiKey, {
    from: config.sipLine,
    to: booking.clientPhone,
    caller_id: config.callerId ?? config.publicPhone,
  });

  // 5. Update CallLog
  const finalStatus = novofonResult.success ? "RINGING" : "FAILED";
  const updated = await prisma.callLog.update({
    where: { id: callLog.id },
    data: {
      status: finalStatus,
      externalCallId: novofonResult.call_id ?? null,
      errorMessage: novofonResult.error ?? null,
    },
  });

  // 6. Log
  if (novofonResult.success) {
    await log.info("telephony", "outbound_call_initiated", {
      callLogId: callLog.id,
      bookingId,
      moduleSlug,
      externalCallId: novofonResult.call_id,
    });
    await logAudit(managerId, "call.initiated", "CallLog", callLog.id, {
      bookingId,
      moduleSlug,
    });
  } else {
    await log.error("telephony", "outbound_call_failed", {
      callLogId: callLog.id,
      bookingId,
      moduleSlug,
      error: novofonResult.error,
    });
  }

  if (!novofonResult.success) {
    throw new TelephonyError(
      "NOVOFON_ERROR",
      novofonResult.error ?? "Ошибка при инициации звонка",
      503
    );
  }

  return updated;
}

// === DIRECT OUTBOUND CALL (no booking — for tenant contacts) ===

/**
 * Initiate a direct outbound call to any phone number.
 * Uses NOVOFON_DEFAULT_SIP_LINE env var as the "from" SIP line.
 * Sequence: create CallLog → call Novofon API → update CallLog → audit log.
 */
export async function initiateDirectCall(
  managerId: string,
  phone: string,
  opts: { tenantId?: string; context?: string } = {}
) {
  const apiKey = process.env.NOVOFON_API_KEY;
  if (!apiKey) {
    throw new TelephonyError(
      "TELEPHONY_NOT_CONFIGURED",
      "API ключ Novofon не настроен"
    );
  }

  const sipLine = process.env.NOVOFON_DEFAULT_SIP_LINE ?? "";
  if (!sipLine) {
    throw new TelephonyError(
      "TELEPHONY_NOT_CONFIGURED",
      "SIP-линия не настроена (NOVOFON_DEFAULT_SIP_LINE)"
    );
  }

  const callLog = await prisma.callLog.create({
    data: {
      moduleSlug: "rental",
      direction: "OUTBOUND",
      status: "INITIATED",
      clientPhone: phone,
      managerPhone: sipLine,
      initiatedBy: managerId,
      metadata: opts.tenantId
        ? { tenantId: opts.tenantId, context: opts.context }
        : opts.context
        ? { context: opts.context }
        : undefined,
    },
  });

  const novofonResult = await novofonStartCall(apiKey, {
    from: sipLine,
    to: phone,
    caller_id: process.env.NOVOFON_CALLER_ID ?? undefined,
  });

  const finalStatus = novofonResult.success ? "RINGING" : "FAILED";
  const updated = await prisma.callLog.update({
    where: { id: callLog.id },
    data: {
      status: finalStatus,
      externalCallId: novofonResult.call_id ?? null,
      errorMessage: novofonResult.error ?? null,
    },
  });

  if (novofonResult.success) {
    await log.info("telephony", "direct_call_initiated", {
      callLogId: callLog.id,
      phone,
      tenantId: opts.tenantId,
    });
    await logAudit(managerId, "call.direct", "CallLog", callLog.id, {
      phone,
      tenantId: opts.tenantId,
    });
  } else {
    await log.error("telephony", "direct_call_failed", {
      callLogId: callLog.id,
      phone,
      error: novofonResult.error,
    });
  }

  if (!novofonResult.success) {
    throw new TelephonyError(
      "NOVOFON_ERROR",
      novofonResult.error ?? "Ошибка при инициации звонка",
      503
    );
  }

  return updated;
}

// === SMS ===
// Удалено: у Novofon нет API исходящих SMS (после ребренда из Zadarma фичу убрали).
// Если в будущем будет другой канал (WhatsApp/Telegram/реальный SMS-провайдер),
// логировать в существующую таблицу SmsLog (она оставлена в БД для переиспользования).


// === WEBHOOK (INBOUND / CALL EVENTS) ===

/**
 * Handle incoming webhook from Novofon.
 * - Updates CallLog status/duration/recording for known call_id (outbound)
 * - Creates CallLog for inbound calls and tries to attribute to booking
 */
export async function handleWebhook(payload: NovofonWebhookPayload) {
  const { event, call_id, direction, duration, recording_url, caller } = payload;

  // Try to find existing CallLog by externalCallId
  const existing = call_id
    ? await prisma.callLog.findFirst({
        where: { externalCallId: call_id },
      })
    : null;

  if (existing) {
    // Update existing (outbound call status update)
    const newStatus = mapEventToStatus(event, existing.status);
    await prisma.callLog.update({
      where: { id: existing.id },
      data: {
        status: newStatus,
        duration: duration ?? existing.duration,
        recordingUrl: recording_url ?? existing.recordingUrl,
        metadata: JSON.parse(JSON.stringify(payload)),
      },
    });

    await log.info("telephony", `webhook_${event}`, {
      callLogId: existing.id,
      externalCallId: call_id,
      newStatus,
    });
    return;
  }

  // New inbound call — try to attribute to booking
  if (direction === "inbound" && caller) {
    const bookingId = await findBookingByPhone(caller);

    await prisma.callLog.create({
      data: {
        bookingId: bookingId ?? null,
        moduleSlug: null,
        direction: "INBOUND",
        status: mapEventToStatus(event, "INITIATED"),
        clientPhone: caller,
        externalCallId: call_id,
        duration: duration ?? null,
        recordingUrl: recording_url ?? null,
        metadata: JSON.parse(JSON.stringify(payload)),
      },
    });

    await log.info("telephony", "inbound_call_received", {
      caller,
      bookingId: bookingId ?? "unattributed",
      externalCallId: call_id,
    });
  }
}

// === QUERIES ===

export async function listCallsByBooking(bookingId: string): Promise<CallLogWithManager[]> {
  const calls = await prisma.callLog.findMany({
    where: { bookingId },
    orderBy: { createdAt: "desc" },
  });

  return enrichWithManagerNames(calls);
}

export async function listCalls(filter: CallFilter) {
  const where = {
    ...(filter.bookingId && { bookingId: filter.bookingId }),
    ...(filter.moduleSlug && { moduleSlug: filter.moduleSlug }),
    ...(filter.status && { status: filter.status as import("@prisma/client").CallStatus }),
    ...(filter.dateFrom || filter.dateTo
      ? {
          createdAt: {
            ...(filter.dateFrom && { gte: new Date(filter.dateFrom) }),
            ...(filter.dateTo && {
              lte: new Date(`${filter.dateTo}T23:59:59.999Z`),
            }),
          },
        }
      : {}),
  };

  const offset = (filter.page - 1) * filter.perPage;

  const [calls, total] = await Promise.all([
    prisma.callLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filter.perPage,
      skip: offset,
    }),
    prisma.callLog.count({ where }),
  ]);

  const enriched = await enrichWithManagerNames(calls);

  return { calls: enriched, total, page: filter.page, perPage: filter.perPage };
}

export async function getCallLog(callLogId: string) {
  return prisma.callLog.findUnique({ where: { id: callLogId } });
}

export async function getRecordingUrl(callLogId: string): Promise<string | null> {
  const callLog = await prisma.callLog.findUnique({
    where: { id: callLogId },
    select: { recordingUrl: true, status: true },
  });

  if (!callLog) return null;
  return callLog.recordingUrl;
}

// === HEALTH ===

export async function getTelephonyHealth() {
  const apiKey = process.env.NOVOFON_API_KEY ?? "";
  const novofonStatus = await novofonCheckStatus(apiKey);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalToday, lastCall] = await Promise.all([
    prisma.callLog.count({
      where: { createdAt: { gte: today } },
    }),
    prisma.callLog.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    status: novofonStatus.configured ? "ok" : "degraded",
    novofonApiConfigured: novofonStatus.configured,
    novofonBalance: novofonStatus.balance,
    lastCallAt: lastCall?.createdAt ?? null,
    totalCallsToday: totalToday,
  };
}

// === PRIVATE HELPERS ===

function mapEventToStatus(
  event: string,
  currentStatus: import("@prisma/client").CallStatus
): import("@prisma/client").CallStatus {
  switch (event) {
    case "call.ringing":
      return "RINGING";
    case "call.answered":
      return "ANSWERED";
    case "call.completed":
    case "call.hangup":
      return "COMPLETED";
    case "call.no_answer":
      return "NO_ANSWER";
    case "call.busy":
      return "BUSY";
    case "call.failed":
      return "FAILED";
    default:
      return currentStatus;
  }
}

async function findBookingByPhone(phone: string): Promise<string | null> {
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const threeDaysAhead = new Date();
  threeDaysAhead.setDate(threeDaysAhead.getDate() + 3);

  const booking = await prisma.booking.findFirst({
    where: {
      clientPhone: phone,
      date: { gte: threeDaysAgo, lte: threeDaysAhead },
      status: { in: ["PENDING", "CONFIRMED", "CHECKED_IN"] },
    },
    orderBy: { date: "asc" },
    select: { id: true },
  });

  return booking?.id ?? null;
}

async function enrichWithManagerNames(
  calls: import("@prisma/client").CallLog[]
): Promise<CallLogWithManager[]> {
  const managerIds = [
    ...new Set(calls.map((c) => c.initiatedBy).filter(Boolean) as string[]),
  ];

  if (managerIds.length === 0) {
    return calls.map((c) => ({ ...c, initiatedByName: null }));
  }

  const users = await prisma.user.findMany({
    where: { id: { in: managerIds } },
    select: { id: true, name: true },
  });

  const nameMap = new Map(users.map((u) => [u.id, u.name]));

  return calls.map((c) => ({
    ...c,
    initiatedByName: c.initiatedBy ? (nameMap.get(c.initiatedBy) ?? null) : null,
  }));
}

export class TelephonyError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.name = "TelephonyError";
  }
}
