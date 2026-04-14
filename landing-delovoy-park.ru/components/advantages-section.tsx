"use client";

import { useState, useEffect } from "react";
import type { ReviewsMeta } from "@landing/lib/parsers/types";

const getAdvantages = (meta: ReviewsMeta) => [
  {
    title: `${meta.totalReviews}+ отзывов`,
    description: `Рейтинг ${meta.rating.toFixed(1)} из 5 на Яндекс Картах — лучший среди бизнес-центров Наро-Фоминского района.`,
    highlight: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
    ),
    color: "#FBC02D",
    tag: "★ Рейтинг",
  },
  {
    title: "Парковка 100+ мест",
    description: "Бесплатно для арендаторов и гостей, без ограничений по времени. Никогда не ищите место рядом с бизнес-центром.",
    highlight: false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="3" width="15" height="13" rx="2"/>
        <path d="M16 8h4l3 3v5h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/>
        <circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>
    ),
    color: "#0071e3",
    tag: "Бесплатно",
  },
  {
    title: "Охрана 24/7",
    description: "Видеонаблюдение, контрольно-пропускная система и круглосуточная охрана. Ваши сотрудники и имущество под защитой.",
    highlight: false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
    color: "#16A34A",
    tag: "Круглосуточно",
  },
  {
    title: "Скоростной интернет",
    description: "Оптоволокно с резервным каналом — работает без сбоев. Поддерживает видеозвонки, облако и любые рабочие задачи.",
    highlight: false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.55a11 11 0 0114.08 0"/>
        <path d="M1.42 9a16 16 0 0121.16 0"/>
        <path d="M8.53 16.11a6 6 0 016.95 0"/>
        <line x1="12" y1="20" x2="12.01" y2="20"/>
      </svg>
    ),
    color: "#7C3AED",
    tag: "Оптоволокно",
  },
  {
    title: "Природа рядом",
    description: "Берёзовый парк, беседки с мангалом и зелёные зоны прямо на территории. Редкость для любого бизнес-центра.",
    highlight: false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 8C8 10 5.9 16.17 3.82 19H10c1.71-2 3.8-3.13 6-3.5C19.35 15 21 13 21 9a8 8 0 00-4-6.92"/>
        <path d="M9.37 15.29C9.14 17.14 8.41 20 6 22h12c-1.97-2.53-2.86-5-3-7"/>
      </svg>
    ),
    color: "#16A34A",
    tag: "Зелёная зона",
  },
  {
    title: "30 км от Москвы",
    description: "40 минут по Киевскому шоссе. Удобно из Москвы, Новой Москвы, Апрелевки и всего запада Подмосковья.",
    highlight: false,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
      </svg>
    ),
    color: "#EA580C",
    tag: "Киевское ш.",
  },
];

export function AdvantagesSection() {
  const [meta, setMeta] = useState<ReviewsMeta>({ rating: 5.0, totalReviews: 300 });

  useEffect(() => {
    fetch("/api/reviews")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data?.meta) {
          setMeta(data.data.meta);
        }
      })
      .catch(() => {});
  }, []);

  const advantages = getAdvantages(meta);

  return (
    <section id="advantages" className="bg-white py-24 px-6">
      <div className="max-w-[1200px] mx-auto">
        <div className="mb-14">
          <h2
            className="font-[family-name:var(--font-manrope)] font-[600] text-[#1d1d1f]"
            style={{
              fontSize: "clamp(36px, 5vw, 64px)",
              letterSpacing: "clamp(-1px, -0.03em, -2.5px)",
              lineHeight: 1,
            }}
          >
            Почему
            <br />
            Деловой?
          </h2>
          <p className="text-[#86868b] font-[family-name:var(--font-inter)] text-[15px] mt-4 max-w-sm leading-relaxed">
            То, за что арендаторы остаются с нами годами — без скидок на слова.
          </p>
        </div>

        {/* Quote from tenant */}
        <div className="mb-10 bg-[#f5f5f7] rounded-2xl p-6 md:p-8 relative overflow-hidden">
          <div className="absolute top-4 left-6 text-[80px] leading-none text-[#0071e3]/10 font-serif select-none">
            "
          </div>
          <blockquote className="relative z-10 text-[#1d1d1f] font-[family-name:var(--font-manrope)] text-lg md:text-xl font-medium leading-relaxed max-w-2xl" style={{ letterSpacing: "-0.3px" }}>
            Мы рассматривали несколько площадок в области. Деловой выбрали за сочетание: доступная цена, живая природа вокруг и всё необходимое уже включено.
          </blockquote>
          <div className="mt-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[#0071e3]/10 flex items-center justify-center text-[#0071e3] text-sm font-semibold font-[family-name:var(--font-manrope)]">
              И
            </div>
            <div>
              <p className="text-[#1d1d1f] text-sm font-semibold font-[family-name:var(--font-manrope)]">Ирина Л.</p>
              <p className="text-[#86868b] text-xs font-[family-name:var(--font-inter)]">Арендатор, 3 года</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {advantages.map((adv) => (
            <div
              key={adv.title}
              className={`rounded-2xl p-6 transition-all hover:scale-[1.01] ${
                adv.highlight
                  ? "bg-[#0071e3]/[0.04] border border-[#0071e3]/[0.12]"
                  : "bg-[#f5f5f7] border border-transparent hover:bg-[#ebebed]"
              }`}
            >
              {/* Icon */}
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                style={{ backgroundColor: `${adv.color}15`, color: adv.color }}
              >
                {adv.icon}
              </div>

              <div className="flex items-start justify-between gap-2 mb-2">
                <h3
                  className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-[16px]"
                  style={{ letterSpacing: "-0.3px" }}
                >
                  {adv.title}
                </h3>
                <span
                  className="text-[10px] font-semibold font-[family-name:var(--font-inter)] px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 mt-0.5"
                  style={{ color: adv.color, backgroundColor: `${adv.color}15` }}
                >
                  {adv.tag}
                </span>
              </div>
              <p className="text-[#86868b] text-[13px] font-[family-name:var(--font-inter)] leading-relaxed">
                {adv.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
