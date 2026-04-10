"use client";

import { useState, useEffect, useRef } from "react";
import type { Review, ReviewsMeta } from "@landing/lib/parsers/types";

export function ReviewsSection() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [meta, setMeta] = useState<ReviewsMeta>({ rating: 5.0, totalReviews: 300 });
  const [loading, setLoading] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const yandexMapsUrl = process.env.NEXT_PUBLIC_YANDEX_MAPS_URL || "#";

  useEffect(() => {
    async function fetchReviews() {
      try {
        const response = await fetch("/api/reviews");
        const data = await response.json();
        if (data.success && data.data) {
          if (Array.isArray(data.data.reviews)) {
            setReviews(data.data.reviews);
          }
          if (data.data.meta) {
            setMeta(data.data.meta);
          }
        }
      } catch (error) {
        console.error("Failed to fetch reviews:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchReviews();
  }, []);

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -400, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 400, behavior: "smooth" });
    }
  };

  return (
    <section className="bg-[#f5f5f7] py-24 px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* Heading + Yandex badge */}
        <div className="mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <h2
              className="font-[family-name:var(--font-manrope)] font-[600] text-[#1d1d1f] text-[42px] md:text-[56px] leading-tight"
              style={{ letterSpacing: "-1.5px" }}
            >
              Отзывы
            </h2>
            <p className="text-[#86868b] text-[15px] font-[family-name:var(--font-inter)] mt-3 leading-relaxed">
              Реальные мнения арендаторов и гостей
            </p>
          </div>

          {/* Yandex Maps badge */}
          <a
            href={yandexMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-3 bg-white rounded-2xl pl-3 pr-5 py-3 shadow-sm hover:shadow-md transition-all group self-start md:self-auto shrink-0 border border-black/[0.04]"
          >
            <div className="flex items-center justify-center w-10 h-10 bg-[#FC3F1D] rounded-xl">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M13.63 21h2.05V3h-3.07c-3.2 0-4.88 1.62-4.88 4.02 0 1.93.89 3.14 2.72 4.38L7.39 17.4h2.2l3.33-6.54-1.15-.77c-1.47-1-2.19-1.88-2.19-3.24 0-1.56 1.06-2.55 2.83-2.55h1.22V21z"
                  fill="white"
                />
              </svg>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="text-[#1d1d1f] font-[family-name:var(--font-manrope)] font-bold text-xl leading-none">
                  {meta.rating.toFixed(1)}
                </span>
                <div className="flex gap-px">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <svg key={i} width="16" height="16" viewBox="0 0 24 24" fill="#FBC02D">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  ))}
                </div>
              </div>
              <span className="text-[#86868b] text-xs font-[family-name:var(--font-inter)]">
                {meta.totalReviews}+ отзывов
              </span>
            </div>
            <svg className="w-4 h-4 text-[#86868b] group-hover:text-[#1d1d1f] transition-colors ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center p-12 bg-white rounded-2xl">
            <p className="text-[#86868b] text-lg">Загрузка отзывов...</p>
          </div>
        ) : reviews.length > 0 ? (
          <div className="relative">
            {/* Carousel container */}
            <div
              ref={scrollContainerRef}
              className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth hide-scrollbar pb-4"
              style={{
                scrollbarWidth: "none",
                msOverflowStyle: "none",
              }}
            >
              {reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>

            {/* Desktop navigation arrows */}
            <button
              onClick={scrollLeft}
              className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-12 h-12 items-center justify-center bg-white hover:bg-[#f5f5f7] shadow-md rounded-full text-[#1d1d1f] transition-all z-10"
              aria-label="Предыдущий отзыв"
            >
              ←
            </button>
            <button
              onClick={scrollRight}
              className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-12 h-12 items-center justify-center bg-white hover:bg-[#f5f5f7] shadow-md rounded-full text-[#1d1d1f] transition-all z-10"
              aria-label="Следующий отзыв"
            >
              →
            </button>
          </div>
        ) : (
          /* Fallback when no reviews */
          <div className="text-center p-12 bg-white rounded-2xl">
            <p className="text-[#1d1d1f] text-lg mb-4 font-[family-name:var(--font-manrope)] font-medium">
              {meta.totalReviews}+ отзывов на Яндекс Картах
            </p>
            <a
              href={yandexMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[#0071e3] hover:text-[#0071e3]/80 transition-colors font-[family-name:var(--font-inter)]"
            >
              Читать отзывы →
            </a>
          </div>
        )}

        {/* Link to all reviews */}
        {reviews.length > 0 && (
          <div className="mt-8 text-center">
            <a
              href={yandexMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[#0071e3] hover:text-[#0071e3]/80 transition-colors font-[family-name:var(--font-inter)] text-sm"
            >
              Все отзывы на Яндекс Картах →
            </a>
          </div>
        )}
      </div>

      <style jsx>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </section>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);

  return (
    <div className="min-w-[300px] md:min-w-[400px] snap-start bg-white rounded-2xl p-6 flex flex-col shadow-sm">
      {/* Rating stars and date */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[#FBC02D] text-lg" aria-label={`${review.rating} из 5 звёзд`}>
          {stars}
        </span>
        <span className="text-[#86868b] text-xs font-[family-name:var(--font-inter)]">
          {review.date}
        </span>
      </div>

      {/* Review text */}
      <p className="text-[#86868b] text-sm leading-relaxed mb-4 font-[family-name:var(--font-inter)] flex-grow">
        {review.text}
      </p>

      {/* Author */}
      <p className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-[15px]">
        {review.author}
      </p>
    </div>
  );
}
