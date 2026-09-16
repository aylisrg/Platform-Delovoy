/**
 * First-party события воронки — запись и агрегация (US-1 эпика #583,
 * ADR 2026-09-16). Никогда не блокирует и не задерживает бизнес-операцию
 * (AC-1.6): `recordFunnelStep` синхронно возвращает `void`, вся запись
 * (Redis-дедуп + `prisma.productEvent.create`) обёрнута в try/catch и не
 * бросает наружу.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";
import { log } from "@/lib/logger";
import { EVENT_SOURCES } from "@/lib/event-sources";
import { toISODate } from "@/lib/format";
import { getFunnel, getStepDef, type FunnelKey, type FunnelStepKey } from "./funnels";
import { aggregateFunnelStats } from "./funnel-stats";
import type { FunnelStatsData } from "./types";

type HeadersLike = { get(name: string): string | null };

// --- sessionKey (AC-1.5, ADR §4) ---

let processSalt: string | null = null;
let warnedNoSalt = false;

function getSalt(): string {
  const envSalt = process.env.PRODUCT_EVENT_SALT;
  if (envSalt) return envSalt;
  if (!processSalt) {
    processSalt = randomBytes(32).toString("hex");
    if (!warnedNoSalt) {
      warnedNoSalt = true;
      // deriveSessionKeyFromHeaders вызывается синхронно прямо в теле роута
      // (не только внутри try/catch recordFunnelStepAsync) — сбой логирования
      // здесь не должен ронять бронирование/заказ (AC-1.6).
      try {
        void log.warn(
          EVENT_SOURCES.ANALYTICS_PRODUCT_EVENT,
          "PRODUCT_EVENT_SALT не задан — используется случайная соль на процесс, склейка сессий не переживёт рестарт"
        );
      } catch {
        // см. комментарий выше
      }
    }
  }
  return processSalt;
}

/**
 * Хэш IP + user-agent + календарная дата МСК — не куки, не JS, не переживает
 * блокировщики (прецедент: src/lib/rate-limit.ts). Известное ограничение:
 * CGNAT мобильных операторов РФ склеивает разных посетителей за одним IP+UA
 * в один sessionKey (ADR §4) — систематическое смещение, не искажает
 * недельную динамику.
 */
export function deriveSessionKeyFromHeaders(headers: HeadersLike): string {
  // Вызывается синхронно прямо в теле роутов бронирования/заказа (не только
  // внутри try/catch recordFunnelStepAsync) — как и trackServerGoal рядом,
  // не должна ронять бронь/заказ ни при каких обстоятельствах (AC-1.6).
  try {
    const realIp = headers.get("x-real-ip")?.trim();
    let ip = realIp || "";
    if (!ip) {
      const xff = headers.get("x-forwarded-for");
      if (xff) {
        const hops = xff.split(",").map((p) => p.trim()).filter(Boolean);
        ip = hops[hops.length - 1] || "";
      }
    }
    if (!ip) ip = "unknown";
    const userAgent = headers.get("user-agent") ?? "";
    const subject = `${ip}|${userAgent}|${toISODate(new Date())}`;
    return createHash("sha256").update(`${getSalt()}|${subject}`).digest("hex").slice(0, 32);
  } catch {
    return "unknown";
  }
}

/** `view` не пишется для префетча роутера и очевидных ботов (ADR §5.3). */
export function isPrefetchOrBot(headers: HeadersLike): boolean {
  if (headers.get("next-router-prefetch")) return true;
  if (headers.get("purpose") === "prefetch") return true;
  if (headers.get("x-purpose") === "preview") return true;
  const ua = headers.get("user-agent") ?? "";
  return /(bot|crawl|spider|slurp|headless|curl|wget|python-requests|monitoring|uptime|probe|facebookexternalhit)/i.test(
    ua
  );
}

// --- запись ---

export type RecordFunnelStepInput = {
  funnel: FunnelKey;
  step: FunnelStepKey;
  /** null — серверное событие без браузерного контекста (вебхук). */
  sessionKey: string | null;
  entityId?: string | null;
  /** Только неперсональные примитивы — см. sanitizeMetadata. */
  metadata?: Record<string, unknown> | null;
};

const METADATA_ALLOWED_KEYS = new Set(["amountRub", "slotCount", "itemCount", "currency"]);

function sanitizeMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!METADATA_ALLOWED_KEYS.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

let lastWarnLogAt = 0;
function logRecordFailureSampled(message: string, error: unknown) {
  const now = Date.now();
  if (now - lastWarnLogAt < 60_000) return;
  lastWarnLogAt = now;
  console.error(`[ProductEvent] ${message}`, error);
  // Вызывается из catch-блока recordFunnelStepAsync/recordPaidStep — если
  // log.warn сам бросит, это станет необработанным отклонением промиса
  // fire-and-forget цепочки (AC-1.6: запись событий не должна течь наружу).
  try {
    void log.warn(EVENT_SOURCES.ANALYTICS_PRODUCT_EVENT, message);
  } catch {
    // см. комментарий выше
  }
}

async function isDuplicate(
  sessionKey: string,
  funnel: FunnelKey,
  step: FunnelStepKey,
  windowSec: number
): Promise<boolean> {
  if (windowSec <= 0 || !redisAvailable) return false;
  try {
    const key = `product-event:dedup:${sessionKey}:${funnel}:${step}`;
    const acquired = await redis.set(key, "1", "EX", windowSec, "NX");
    return acquired === null;
  } catch {
    return false; // fail-open — как в rate-limit.ts
  }
}

/** Резолвится всегда, никогда не бросает (AC-1.6). */
export async function recordFunnelStepAsync(input: RecordFunnelStepInput): Promise<void> {
  try {
    const def = getFunnel(input.funnel);
    const stepDef = getStepDef(input.funnel, input.step);
    if (!def || !stepDef) return;

    if (input.sessionKey && (await isDuplicate(input.sessionKey, input.funnel, input.step, stepDef.dedupeWindowSec))) {
      return;
    }

    await prisma.productEvent.create({
      data: {
        funnel: input.funnel,
        step: input.step,
        sessionKey: input.sessionKey,
        moduleSlug: def.moduleSlug,
        entityId: input.entityId ?? null,
        metadata: sanitizeMetadata(input.metadata),
      },
    });
  } catch (error) {
    logRecordFailureSampled(`Не удалось записать событие воронки ${input.funnel}/${input.step}`, error);
  }
}

/** Fire-and-forget — вызывающий код не получает промис, await ставить некуда. */
export function recordFunnelStep(input: RecordFunnelStepInput): void {
  void recordFunnelStepAsync(input);
}

/**
 * Шаг `paid` (ADR §5.4): наследует sessionKey от последнего `submitted` с
 * тем же entityId за последние 7 дней. Если такого события нет — НЕ пишем
 * (отсекает админские брони с ручной ссылкой на оплату, не даёт paid > submitted).
 *
 * `funnel` принимает произвольную строку (вызывается из `payments/service.ts`
 * с `Payment.moduleSlug`, который не обязательно воронка с шагом `paid` —
 * например, `rental`/`subscriptions`): любой слаг вне каталога или без шага
 * `paid` тихо игнорируется — конверсию считаем только там, где она реально
 * определена.
 */
export async function recordPaidStep(
  funnel: string,
  entityId: string,
  metadata?: Record<string, unknown> | null
): Promise<void> {
  try {
    const def = getFunnel(funnel);
    const stepDef = getStepDef(funnel, "paid");
    if (!def || !stepDef) return;

    const prior = await prisma.productEvent.findFirst({
      where: {
        entityId,
        funnel,
        step: "submitted",
        createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
      orderBy: { createdAt: "desc" },
      select: { sessionKey: true },
    });
    if (!prior) return;
    await recordFunnelStepAsync({
      funnel: funnel as FunnelKey,
      step: "paid",
      sessionKey: prior.sessionKey,
      entityId,
      metadata,
    });
  } catch (error) {
    logRecordFailureSampled(`Не удалось записать paid для ${funnel}/${entityId}`, error);
  }
}

// --- агрегация (AC-1.7) ---

type StatsRow = { funnel: string; step: string; events: bigint | number; sessions: bigint | number };

export async function getFunnelStats(params: {
  funnel?: FunnelKey;
  dateFrom: string;
  dateTo: string;
}): Promise<FunnelStatsData> {
  const from = new Date(`${params.dateFrom}T00:00:00.000Z`);
  const to = new Date(`${params.dateTo}T23:59:59.999Z`);

  const rows = params.funnel
    ? await prisma.$queryRaw<StatsRow[]>`
        SELECT funnel, step, COUNT(*)::int AS events, COUNT(DISTINCT "sessionKey")::int AS sessions
        FROM "ProductEvent"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to} AND funnel = ${params.funnel}
        GROUP BY funnel, step
      `
    : await prisma.$queryRaw<StatsRow[]>`
        SELECT funnel, step, COUNT(*)::int AS events, COUNT(DISTINCT "sessionKey")::int AS sessions
        FROM "ProductEvent"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY funnel, step
      `;

  return aggregateFunnelStats(
    rows.map((r) => ({ funnel: r.funnel, step: r.step, events: Number(r.events), sessions: Number(r.sessions) })),
    { dateFrom: params.dateFrom, dateTo: params.dateTo },
    params.funnel
  );
}
