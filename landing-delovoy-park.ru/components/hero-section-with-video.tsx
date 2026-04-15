"use client";

import { useState } from "react";

const yandexMapsUrl = process.env.NEXT_PUBLIC_YANDEX_MAPS_URL || "#";

export function HeroSectionWithVideo() {
  const [videoError, setVideoError] = useState(false);

  return (
    <section className="relative min-h-screen flex flex-col justify-center bg-[#f5f5f7] pt-14 overflow-hidden">
      {/* Video background (desktop only) */}
      {!videoError && (
        <video
          className="absolute inset-0 w-full h-full object-cover hidden md:block"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          poster="/media/hero-poster.jpg"
          onError={() => setVideoError(true)}
        >
          <source src="/media/hero.mp4" type="video/mp4" />
        </video>
      )}

      {/* Mobile poster */}
      <div className="absolute inset-0 md:hidden">
        <img
          src="/media/hero-poster.jpg"
          className="w-full h-full object-cover opacity-30"
          alt=""
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      </div>

      {/* Light overlay for text readability */}
      <div className="absolute inset-0 bg-white/70 z-[1]" />

      {/* Content */}
      <div className="relative z-10 max-w-[1200px] mx-auto w-full py-24 md:py-32 px-6">
        {/* Yandex rating badge */}
        <a
          href={yandexMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-3 bg-white rounded-2xl pl-3 pr-5 py-2.5 mb-10 shadow-sm hover:shadow-md transition-all group border border-black/[0.04]"
        >
          {/* Yandex logo */}
          <div className="flex items-center justify-center w-8 h-8 bg-[#FC3F1D] rounded-lg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M13.63 21h2.05V3h-3.07c-3.2 0-4.88 1.62-4.88 4.02 0 1.93.89 3.14 2.72 4.38L7.39 17.4h2.2l3.33-6.54-1.15-.77c-1.47-1-2.19-1.88-2.19-3.24 0-1.56 1.06-2.55 2.83-2.55h1.22V21z"
                fill="white"
              />
            </svg>
          </div>
          {/* Rating */}
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="text-[#1d1d1f] font-[family-name:var(--font-manrope)] font-bold text-lg leading-none">
                5.0
              </span>
              <div className="flex gap-px">
                {[1, 2, 3, 4, 5].map((i) => (
                  <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill="#FBC02D">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                ))}
              </div>
            </div>
            <span className="text-[#86868b] text-xs font-[family-name:var(--font-inter)] leading-tight">
              280+ отзывов на Яндекс Картах
            </span>
          </div>
          {/* Arrow */}
          <svg className="w-4 h-4 text-[#86868b] group-hover:text-[#1d1d1f] transition-colors ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </a>

        {/* Display headline */}
        <h1
          className="font-[family-name:var(--font-manrope)] font-[600] text-[#1d1d1f] leading-[0.9]"
          style={{
            fontSize: "clamp(48px, 8vw, 96px)",
            letterSpacing: "clamp(-2px, -0.04em, -4px)",
          }}
        >
          Бизнес-парк,
          <br />
          которому
          <br />
          <span className="text-[#0071e3]">доверяют.</span>
        </h1>

        {/* Sub */}
        <p className="mt-6 text-[#86868b] font-[family-name:var(--font-inter)] text-lg max-w-xl leading-relaxed">
          Каждый отзыв — 5 звёзд. Это не случайность,
          это&nbsp;то, как мы работаем каждый день.
          <br />
          <span className="text-[#1d1d1f]/40 text-sm mt-1 block">
            Селятино, Московская область
          </span>
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col sm:flex-row gap-4">
          <a
            href="#offices"
            className="inline-flex items-center justify-center bg-[#0071e3] hover:bg-[#0077ED] text-white font-medium text-[15px] px-8 py-4 rounded-full transition-all font-[family-name:var(--font-inter)]"
          >
            Записаться в лист ожидания
          </a>
          <a
            href="#services"
            className="inline-flex items-center justify-center bg-[#1d1d1f]/[0.06] hover:bg-[#1d1d1f]/[0.1] text-[#1d1d1f] font-medium text-[15px] px-8 py-4 rounded-full transition-all font-[family-name:var(--font-inter)]"
          >
            Посмотреть услуги
          </a>
        </div>

        {/* Stats row */}
        <div className="mt-20 pt-10 border-t border-black/[0.06] grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { value: "280+", label: "отзывов на Яндексе" },
            { value: "5.0", label: "средний рейтинг" },
            { value: "100+", label: "офисов в парке" },
            { value: "30 км", label: "от Москвы" },
          ].map((stat) => (
            <div key={stat.label}>
              <p
                className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-[36px] leading-tight"
                style={{ letterSpacing: "-1px" }}
              >
                {stat.value}
              </p>
              <p className="text-[#86868b] text-sm font-[family-name:var(--font-inter)] mt-1">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
