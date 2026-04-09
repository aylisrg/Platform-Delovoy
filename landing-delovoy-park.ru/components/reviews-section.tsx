"use client";

import { useState, useEffect, useRef } from "react";
import type { Review } from "@landing/lib/parsers/types";

export function ReviewsSection() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const yandexMapsUrl = process.env.NEXT_PUBLIC_YANDEX_MAPS_URL || "#";

  useEffect(() => {
    async function fetchReviews() {
      try {
        const response = await fetch("/api/reviews");
        const data = await response.json();
        if (data.success && Array.isArray(data.data)) {
          setReviews(data.data);
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
    <section className="bg-black py-24 px-6 border-t border-white/5">
      <div className="max-w-[1200px] mx-auto">
        {/* Heading */}
        <div className="mb-10">
          <h2
            className="font-[family-name:var(--font-manrope)] font-[500] text-white text-[42px] md:text-[56px] leading-tight"
            style={{ letterSpacing: "-1.5px" }}
          >
            Отзывы
          </h2>
          <p className="text-[#a6a6a6] text-lg font-[family-name:var(--font-inter)] mt-3">
            Реальные мнения арендаторов и гостей
          </p>
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center p-12 border border-white/10 rounded-[14px]">
            <p className="text-[#a6a6a6] text-lg">Загрузка отзывов...</p>
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
              className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-12 h-12 items-center justify-center bg-white/10 hover:bg-white/20 border border-white/10 rounded-full text-white transition-all z-10"
              aria-label="Предыдущий отзыв"
            >
              ←
            </button>
            <button
              onClick={scrollRight}
              className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-12 h-12 items-center justify-center bg-white/10 hover:bg-white/20 border border-white/10 rounded-full text-white transition-all z-10"
              aria-label="Следующий отзыв"
            >
              →
            </button>
          </div>
        ) : (
          /* Fallback when no reviews */
          <div className="text-center p-12 border border-white/10 rounded-[14px] bg-[#090909]">
            <p className="text-white text-lg mb-4 font-[family-name:var(--font-manrope)] font-medium">
              300+ отзывов на Яндекс Картах
            </p>
            <a
              href={yandexMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[#0099ff] hover:text-[#0099ff]/80 transition-colors font-[family-name:var(--font-inter)]"
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
              className="inline-flex items-center gap-2 text-[#0099ff] hover:text-[#0099ff]/80 transition-colors font-[family-name:var(--font-inter)] text-sm"
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
    <div className="min-w-[300px] md:min-w-[400px] snap-start bg-[#090909] border border-white/6 rounded-[14px] p-6 flex flex-col">
      {/* Rating stars and date */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[#0099ff] text-lg" aria-label={`${review.rating} из 5 звёзд`}>
          {stars}
        </span>
        <span className="text-white/40 text-xs font-[family-name:var(--font-inter)]">
          {review.date}
        </span>
      </div>

      {/* Review text */}
      <p className="text-[#a6a6a6] text-sm leading-relaxed mb-4 font-[family-name:var(--font-inter)] flex-grow">
        {review.text}
      </p>

      {/* Author */}
      <p className="font-[family-name:var(--font-manrope)] font-semibold text-white text-base">
        {review.author}
      </p>
    </div>
  );
}
