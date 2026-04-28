/**
 * Avito reviews sync — fetches reviews per item, persists with idempotent UNIQUE
 * on avitoReviewId, sends Telegram alerts for new ratings <= 3.
 *
 * Architecture: docs/architecture/2026-04-28-delovoy-avito-adr.md (US-3.1, US-3.2).
 */

import { prisma } from "@/lib/db";
import { sendTelegramAlert } from "@/lib/telegram-alert";
import { avitoFetch, isAvitoCredentialsConfigured } from "./client";
import { AvitoApiError } from "./types";

/** Threshold at which a review is considered "negative" and triggers an alert. */
export const NEGATIVE_RATING_THRESHOLD = 3;

/** Snippet length for the alert body. */
const ALERT_BODY_SNIPPET_LEN = 300;

/** Raw review payload shape returned by the Avito API.
 * Shape is deliberately loose because Avito documents the endpoint sparsely
 * and field naming differs across api versions.
 *
 * TODO(arch): The exact Reviews endpoint URL is not documented in the public
 * Avito catalog at the time of writing — `/ratings/v1/info` is referenced in
 * archived OSS clients. We use it as the primary path. If Avito returns 404
 * we silently treat the item as having no reviews (no alert, no avg update).
 */
export type RawAvitoReview = {
  id: string | number;
  rating?: number;
  score?: number;
  stars?: number;
  authorName?: string;
  author?: { name?: string } | string;
  body?: string;
  text?: string;
  comment?: string;
  reviewedAt?: string;
  createdAt?: string;
  created?: string | number;
};

/**
 * Fetch raw reviews for one Avito item.
 * `sinceDate` is forwarded as `dateFrom` query param if provided — the Avito
 * Reviews endpoint accepts a date filter; we ignore the result if the API
 * does not actually filter (we still de-dupe locally on avitoReviewId).
 */
export async function fetchReviewsForItem(
  avitoItemId: string,
  sinceDate?: Date
): Promise<RawAvitoReview[]> {
  if (!isAvitoCredentialsConfigured()) return [];

  const numericId = Number.parseInt(avitoItemId, 10);
  if (!Number.isFinite(numericId)) return [];

  const query: Record<string, string | number | undefined> = {
    item_id: avitoItemId,
  };
  if (sinceDate) {
    query.dateFrom = sinceDate.toISOString().slice(0, 10);
  }

  try {
    const res = await avitoFetch<{
      reviews?: RawAvitoReview[];
      result?: { reviews?: RawAvitoReview[] };
      items?: RawAvitoReview[];
    }>("/ratings/v1/info", { query });
    return res?.reviews ?? res?.result?.reviews ?? res?.items ?? [];
  } catch (err) {
    if (err instanceof AvitoApiError && err.status === 404) return [];
    throw err;
  }
}

/** Normalise rating from any of the loose source field names. */
function pickRating(raw: RawAvitoReview): number | null {
  const v = raw.rating ?? raw.score ?? raw.stars;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const r = Math.round(v);
  if (r < 1 || r > 5) return null;
  return r;
}

function pickBody(raw: RawAvitoReview): string | null {
  return raw.body ?? raw.text ?? raw.comment ?? null;
}

function pickAuthor(raw: RawAvitoReview): string | null {
  if (typeof raw.author === "string") return raw.author;
  return raw.authorName ?? raw.author?.name ?? null;
}

function pickReviewedAt(raw: RawAvitoReview): Date {
  const v = raw.reviewedAt ?? raw.createdAt ?? raw.created;
  if (typeof v === "number") return new Date(v * 1000);
  if (typeof v === "string") {
    const parsed = new Date(v);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function clipBody(body: string | null): string {
  if (!body) return "(без текста)";
  if (body.length <= ALERT_BODY_SNIPPET_LEN) return body;
  return body.slice(0, ALERT_BODY_SNIPPET_LEN) + "…";
}

/**
 * Sync reviews for a single item:
 *  - Idempotent insert (UNIQUE on avitoReviewId) — re-runs are safe.
 *  - For new reviews with rating <= 3 sends Telegram alert (once, guarded by alertSent).
 *  - Updates AvitoItem.avgRating + reviewsCount denormalised values.
 *
 * Returns counters of how many reviews were added and how many alerts were sent.
 */
export async function syncReviewsForItem(avitoItem: {
  id: string;
  avitoItemId: string;
  title?: string | null;
  url?: string | null;
}): Promise<{ added: number; alerted: number }> {
  let added = 0;
  let alerted = 0;

  let raws: RawAvitoReview[] = [];
  try {
    raws = await fetchReviewsForItem(avitoItem.avitoItemId);
  } catch {
    // API unavailable — no-op, leave existing data untouched.
    return { added, alerted };
  }

  for (const raw of raws) {
    const avitoReviewId = String(raw.id);
    if (!avitoReviewId) continue;
    const rating = pickRating(raw);
    if (rating === null) continue;

    const existing = await prisma.avitoReview.findUnique({
      where: { avitoReviewId },
      select: { id: true, alertSent: true, rating: true },
    });

    if (existing) {
      // Already synced. Send alert only if it was missed previously and is
      // still considered negative — guard prevents repeats by alertSent flag.
      if (!existing.alertSent && existing.rating <= NEGATIVE_RATING_THRESHOLD) {
        const sent = await sendNegativeReviewAlert({
          avitoItem,
          rating: existing.rating,
          authorName: pickAuthor(raw),
          body: pickBody(raw),
          avitoReviewId,
        });
        if (sent) {
          await prisma.avitoReview.update({
            where: { avitoReviewId },
            data: { alertSent: true },
          });
          alerted += 1;
        }
      }
      continue;
    }

    const body = pickBody(raw);
    const authorName = pickAuthor(raw);
    const reviewedAt = pickReviewedAt(raw);
    const isNegative = rating <= NEGATIVE_RATING_THRESHOLD;

    let alertSent = false;
    if (isNegative) {
      alertSent = await sendNegativeReviewAlert({
        avitoItem,
        rating,
        authorName,
        body,
        avitoReviewId,
      });
      if (alertSent) alerted += 1;
    }

    try {
      await prisma.avitoReview.create({
        data: {
          avitoReviewId,
          avitoItemId: avitoItem.id,
          rating,
          authorName,
          body,
          reviewedAt,
          alertSent,
        },
      });
      added += 1;
    } catch (err) {
      // Race: another worker inserted simultaneously. UNIQUE on avitoReviewId
      // protects us; treat as already-handled.
      if (isUniqueViolation(err)) continue;
      throw err;
    }
  }

  // Recompute denormalised aggregates from the full set of reviews.
  await recomputeItemAggregates(avitoItem.id);

  return { added, alerted };
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
  );
}

async function recomputeItemAggregates(avitoItemDbId: string): Promise<void> {
  const agg = await prisma.avitoReview.aggregate({
    where: { avitoItemId: avitoItemDbId },
    _avg: { rating: true },
    _count: { _all: true },
  });
  await prisma.avitoItem.update({
    where: { id: avitoItemDbId },
    data: {
      avgRating: agg._avg.rating ?? null,
      reviewsCount: agg._count._all,
    },
  });
}

async function sendNegativeReviewAlert(args: {
  avitoItem: { avitoItemId: string; title?: string | null; url?: string | null };
  rating: number;
  authorName: string | null;
  body: string | null;
  avitoReviewId: string;
}): Promise<boolean> {
  const stars = "⭐".repeat(args.rating) + "☆".repeat(5 - args.rating);
  const lines = [
    `<b>Негативный отзыв на Авито</b> ${stars} (${args.rating}/5)`,
    `Объявление: ${escapeHtml(args.avitoItem.title ?? args.avitoItem.avitoItemId)}`,
    args.authorName ? `Автор: ${escapeHtml(args.authorName)}` : null,
    "",
    escapeHtml(clipBody(args.body)),
    "",
    args.avitoItem.url ? `Ссылка: ${args.avitoItem.url}` : null,
  ].filter((s): s is string => s !== null);
  return sendTelegramAlert(lines.join("\n"), { parseMode: "HTML" });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Sync reviews for all active, non-deleted Avito items. Returns aggregate counters.
 */
export async function syncAllReviews(): Promise<{
  items: number;
  added: number;
  alerted: number;
}> {
  const items = await prisma.avitoItem.findMany({
    where: { deletedAt: null, status: "ACTIVE" },
    select: { id: true, avitoItemId: true, title: true, url: true },
  });

  let added = 0;
  let alerted = 0;
  for (const item of items) {
    try {
      const r = await syncReviewsForItem(item);
      added += r.added;
      alerted += r.alerted;
    } catch (err) {
      console.error("[avito.reviews.syncAllReviews] item failed", item.avitoItemId, err);
    }
  }
  return { items: items.length, added, alerted };
}
