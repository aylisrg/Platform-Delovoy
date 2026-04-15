"use client";

import { useState, useRef } from "react";
import React from "react";
import type { Review } from "@landing/lib/parsers/types";

// Static reviews shown as default / fallback
const STATIC_REVIEWS: Review[] = [
  {
    id: "s1",
    author: "Сергей М.",
    rating: 5,
    text: "Арендуем офис уже два года. Отличная территория, тихо, парковка всегда есть. Были опасения насчёт расстояния от Москвы, но 30 минут по Киевскому — совсем не проблема. Кафе хорошее, обедаем там каждый день. Рекомендую всем, кто ищет офис в области.",
    date: "2 недели назад",
    source: "yandex",
  },
  {
    id: "s2",
    author: "Анна К.",
    rating: 5,
    text: "Были на корпоративном мероприятии в Барбекю Парке — просто огонь! Беседки большие, мангал хороший, зелёная территория очень красивая. Персонал помог с организацией и всё заранее подготовил. Коллеги в восторге, обязательно приедем ещё.",
    date: "1 месяц назад",
    source: "yandex",
  },
  {
    id: "s3",
    author: "Дмитрий В.",
    rating: 5,
    text: "Плей Парк — отличное место для командного отдыха. PlayStation 5, большие экраны, удобные кресла. Провели три часа, все остались очень довольны. Организаторы дружелюбные, всё объяснили. Будем приезжать регулярно на командные встречи.",
    date: "3 недели назад",
    source: "yandex",
  },
  {
    id: "s4",
    author: "Ирина Л.",
    rating: 5,
    text: "Офис снимаем здесь давно. Удобная локация — клиенты без проблем добираются и из Москвы, и из области. Охрана работает чётко, интернет стабильный, парковки хватает. Чистота и порядок на территории радуют каждый день. Однозначно рекомендую.",
    date: "5 дней назад",
    source: "yandex",
  },
  {
    id: "s5",
    author: "Михаил Т.",
    rating: 5,
    text: "Приехали с семьёй на выходные — погуляли по территории и поели в кафе. Вкусно, цены нормальные, обслуживание быстрое. Зелёная зона красивая, дети были в восторге. Неожиданно приятное место, чтобы выбраться из города.",
    date: "2 месяца назад",
    source: "yandex",
  },
  {
    id: "s6",
    author: "Олег Р.",
    rating: 5,
    text: "Хорошее место для работы за городом. Тихо, природа, нет суеты как в Москве. Снял офис полгода назад — пожалею только о том, что не сделал это раньше. Цены адекватные, всё включено в аренду. Особенно ценю беседки — летом обеды на свежем воздухе это просто кайф.",
    date: "1 месяц назад",
    source: "yandex",
  },
  {
    id: "s7",
    author: "Наталья Ф.",
    rating: 5,
    text: "Приехали на Плей Парк с компанией из 6 человек. Заняли два зала, играли часа три. Оборудование новое, всё исправно работает. Персонал внимательный, помогли выбрать игры. Цены разумные. Отличное место для корпоративного досуга!",
    date: "3 недели назад",
    source: "yandex",
  },
  {
    id: "s8",
    author: "Артём К.",
    rating: 5,
    text: "Барбекю Парк порадовал — беседки просторные, мангалы чистые, дрова дали. Территория ухоженная, деревья, зелень — настоящий отдых на природе. Приезжали отмечать день рождения, всё прошло на ура. Отдельное спасибо за бесплатную парковку!",
    date: "6 недель назад",
    source: "yandex",
  },
];

export function ReviewsSection() {
  const [reviews] = useState<Review[]>(STATIC_REVIEWS);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const yandexMapsUrl = process.env.NEXT_PUBLIC_YANDEX_MAPS_URL || "https://yandex.ru/maps/-/CPviBFyh";
  const twogisUrl = "https://2gis.ru/moscow/search/%D0%B1%D0%B8%D0%B7%D0%BD%D0%B5%D1%81-%D0%BF%D0%B0%D1%80%D0%BA-%D0%B4%D0%B5%D0%BB%D0%BE%D0%B2%D0%BE%D0%B9-%D1%81%D0%B5%D0%BB%D1%8F%D1%82%D0%B8%D0%BD%D0%BE";

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -420, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 420, behavior: "smooth" });
    }
  };

  return (
    <section className="bg-[#f5f5f7] py-24 px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* Heading + badges */}
        <div className="mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <h2
              className="font-[family-name:var(--font-manrope)] font-[600] text-[#1d1d1f] text-[42px] md:text-[56px] leading-tight"
              style={{ letterSpacing: "-1.5px" }}
            >
              Отзывы
            </h2>
            <p className="text-[#86868b] text-[15px] font-[family-name:var(--font-inter)] mt-3 leading-relaxed">
              Реальные мнения арендаторов и гостей бизнес-парка
            </p>
          </div>

          {/* Rating badges */}
          <div className="flex flex-wrap gap-3 self-start md:self-auto shrink-0">
            {/* Yandex badge */}
            <a
              href={yandexMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 bg-white rounded-2xl pl-3 pr-5 py-3 shadow-sm hover:shadow-md transition-all group border border-black/[0.04]"
            >
              <div className="flex items-center justify-center w-9 h-9 bg-[#FC3F1D] rounded-xl">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M13.63 21h2.05V3h-3.07c-3.2 0-4.88 1.62-4.88 4.02 0 1.93.89 3.14 2.72 4.38L7.39 17.4h2.2l3.33-6.54-1.15-.77c-1.47-1-2.19-1.88-2.19-3.24 0-1.56 1.06-2.55 2.83-2.55h1.22V21z" fill="white"/>
                </svg>
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1">
                  <span className="text-[#1d1d1f] font-[family-name:var(--font-manrope)] font-bold text-lg leading-none">
                    5.0
                  </span>
                  <span className="text-[#FBC02D] text-sm">★★★★★</span>
                </div>
                <span className="text-[#86868b] text-[11px] font-[family-name:var(--font-inter)]">
                  280+ на Яндексе
                </span>
              </div>
            </a>

            {/* 2GIS badge */}
            <a
              href={twogisUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 bg-white rounded-2xl pl-3 pr-5 py-3 shadow-sm hover:shadow-md transition-all group border border-black/[0.04]"
            >
              <div className="flex items-center justify-center w-9 h-9 bg-[#00B140] rounded-xl">
                <svg width="18" height="18" viewBox="0 0 32 32" fill="white">
                  <path d="M16 3C9.373 3 4 8.373 4 15c0 4.437 2.278 8.345 5.715 10.638L16 29l6.285-3.362C25.722 23.345 28 19.437 28 15c0-6.627-5.373-12-12-12zm0 18a6 6 0 110-12 6 6 0 010 12z"/>
                </svg>
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-1">
                  <span className="text-[#1d1d1f] font-[family-name:var(--font-manrope)] font-bold text-lg leading-none">5.0</span>
                  <span className="text-[#FBC02D] text-sm">★★★★★</span>
                </div>
                <span className="text-[#86868b] text-[11px] font-[family-name:var(--font-inter)]">на 2ГИС</span>
              </div>
            </a>
          </div>
        </div>

        {/* Content */}
        <div className="relative">
            <div
              ref={scrollContainerRef}
              className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth hide-scrollbar pb-4"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>

            {/* Desktop navigation */}
            <button
              onClick={scrollLeft}
              className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-5 w-12 h-12 items-center justify-center bg-white hover:bg-[#f5f5f7] shadow-md rounded-full text-[#1d1d1f] transition-all z-10 border border-black/[0.05]"
              aria-label="Предыдущий отзыв"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button
              onClick={scrollRight}
              className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-5 w-12 h-12 items-center justify-center bg-white hover:bg-[#f5f5f7] shadow-md rounded-full text-[#1d1d1f] transition-all z-10 border border-black/[0.05]"
              aria-label="Следующий отзыв"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>

        {/* Links */}
        <div className="mt-8 flex flex-wrap gap-4 justify-center">
          <a
            href={yandexMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[#0071e3] hover:text-[#0071e3]/80 transition-colors font-[family-name:var(--font-inter)] text-sm"
          >
            Все отзывы на Яндекс Картах →
          </a>
          <span className="text-[#86868b]/40 text-sm hidden sm:block">·</span>
          <a
            href={twogisUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-[#00B140] hover:opacity-70 transition-opacity font-[family-name:var(--font-inter)] text-sm"
          >
            Все отзывы на 2ГИС →
          </a>
        </div>
      </div>

      <style jsx>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </section>
  );
}

const AVATAR_COLORS = [
  "#0071e3", "#16A34A", "#EA580C", "#7C3AED", "#DC2626", "#0891B2", "#CA8A04", "#BE185D"
];

function ReviewCard({ review }: { review: Review }) {
  const initial = review.author.charAt(0).toUpperCase();
  const colorIndex = review.author.charCodeAt(0) % AVATAR_COLORS.length;
  const avatarColor = AVATAR_COLORS[colorIndex];

  return (
    <div className="min-w-[300px] md:min-w-[380px] max-w-[380px] snap-start bg-white rounded-2xl p-6 flex flex-col shadow-sm border border-black/[0.04] hover:shadow-md transition-shadow">
      {/* Author row */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold font-[family-name:var(--font-manrope)] text-[15px]"
          style={{ backgroundColor: avatarColor }}
        >
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-[14px] truncate">
            {review.author}
          </p>
          <p className="text-[#86868b] text-[11px] font-[family-name:var(--font-inter)]">
            {review.date}
          </p>
        </div>
        {/* Stars */}
        <div className="flex gap-px flex-shrink-0">
          {[1,2,3,4,5].map((i) => (
            <svg key={i} width="13" height="13" viewBox="0 0 24 24" fill={i <= review.rating ? "#FBC02D" : "#e5e7eb"}>
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          ))}
        </div>
      </div>

      {/* Review text */}
      <p className="text-[#3d3d3f] text-[13px] leading-relaxed font-[family-name:var(--font-inter)] flex-grow">
        {review.text}
      </p>

      {/* Source tag */}
      <div className="mt-4 pt-4 border-t border-black/[0.05] flex items-center gap-1.5">
        <div className="w-4 h-4 bg-[#FC3F1D] rounded flex items-center justify-center">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
            <path d="M13.63 21h2.05V3h-3.07c-3.2 0-4.88 1.62-4.88 4.02 0 1.93.89 3.14 2.72 4.38L7.39 17.4h2.2l3.33-6.54-1.15-.77c-1.47-1-2.19-1.88-2.19-3.24 0-1.56 1.06-2.55 2.83-2.55h1.22V21z" fill="white"/>
          </svg>
        </div>
        <span className="text-[#86868b] text-[11px] font-[family-name:var(--font-inter)]">
          Яндекс Карты
        </span>
      </div>
    </div>
  );
}
