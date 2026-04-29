import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/format";

export type RecentReviewItem = {
  id: string;
  avitoReviewId: string;
  rating: number;
  authorName: string | null;
  body: string | null;
  reviewedAt: string;
  itemTitle: string | null;
  itemUrl: string | null;
};

type Props = {
  reviews: RecentReviewItem[];
  /** Average rating across the slice the user is allowed to see. */
  avgRating: number | null;
  /** Total reviews for the same slice. */
  total: number;
};

const NEGATIVE_THRESHOLD = 3;
const SNIPPET_LEN = 240;

function stars(rating: number): string {
  const r = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(r) + "☆".repeat(5 - r);
}

function clip(s: string): string {
  if (s.length <= SNIPPET_LEN) return s;
  return s.slice(0, SNIPPET_LEN) + "…";
}

function formatReviewDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDate(d);
}

export function RecentReviews({ reviews, avgRating, total }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-zinc-900">Последние отзывы</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {total === 0
                ? "Пока нет загруженных отзывов. Запустите cron `/api/cron/avito-reviews-sync`, чтобы загрузить."
                : `Всего отзывов в реестре: ${total}`}
            </p>
          </div>
          {avgRating !== null && (
            <div className="text-right">
              <div className="text-xs text-zinc-500">Средний рейтинг</div>
              <div className="text-lg font-semibold text-zinc-900">
                {avgRating.toFixed(2)}{" "}
                <span className="text-amber-500 text-base">{stars(avgRating)}</span>
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {reviews.length === 0 ? (
          <p className="text-sm text-zinc-500">Нет отзывов.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {reviews.map((r) => {
              const negative = r.rating <= NEGATIVE_THRESHOLD;
              return (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            "text-base font-medium " +
                            (negative ? "text-red-600" : "text-amber-500")
                          }
                          aria-label={`Оценка: ${r.rating} из 5`}
                        >
                          {stars(r.rating)}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {r.rating}/5 • {formatReviewDate(r.reviewedAt)}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-zinc-700">
                        {r.authorName ? (
                          <span className="font-medium">{r.authorName}</span>
                        ) : (
                          <span className="italic text-zinc-400">Без автора</span>
                        )}
                        {r.itemTitle && (
                          <span className="text-zinc-500">
                            {" — "}
                            {r.itemUrl ? (
                              <a
                                href={r.itemUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline"
                              >
                                {r.itemTitle}
                              </a>
                            ) : (
                              r.itemTitle
                            )}
                          </span>
                        )}
                      </div>
                      {r.body && (
                        <p
                          className={
                            "mt-1 text-sm whitespace-pre-line " +
                            (negative ? "text-red-700" : "text-zinc-700")
                          }
                        >
                          {clip(r.body)}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
