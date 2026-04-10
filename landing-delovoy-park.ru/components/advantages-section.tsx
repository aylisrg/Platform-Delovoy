"use client";

import { useState, useEffect } from "react";
import type { ReviewsMeta } from "@landing/lib/parsers/types";

const getAdvantages = (meta: ReviewsMeta) => [
  {
    title: `${meta.totalReviews}+ отзывов на Яндексе`,
    description: `Рейтинг ${meta.rating.toFixed(1)} из 5. Лучший среди бизнес-центров района.`,
    highlight: true,
  },
  {
    title: "Парковка 100+ мест",
    description: "Бесплатно для арендаторов и гостей, без ограничений по времени.",
    highlight: false,
  },
  {
    title: "Охрана 24/7",
    description: "Видеонаблюдение, охраняемая территория и пропускная система.",
    highlight: false,
  },
  {
    title: "Скоростной интернет",
    description: "Оптоволокно с резервированием — работает без сбоев.",
    highlight: false,
  },
  {
    title: "Природа рядом",
    description: "Парк, беседки и зелёная зона — редкость для бизнес-центра.",
    highlight: false,
  },
  {
    title: "40 км от Москвы",
    description: "Удобная доступность из Москвы и Новой Москвы по Киевскому шоссе.",
    highlight: false,
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
            То, что ценят арендаторы, которые уже работают здесь годами.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {advantages.map((adv) => (
            <div
              key={adv.title}
              className={`rounded-2xl p-6 transition-colors ${
                adv.highlight
                  ? "bg-[#0071e3]/[0.04] border border-[#0071e3]/[0.12]"
                  : "bg-[#f5f5f7] border border-transparent"
              }`}
            >
              <h3
                className="font-[family-name:var(--font-manrope)] font-semibold text-[#1d1d1f] text-[15px] mb-2"
                style={{ letterSpacing: "-0.3px" }}
              >
                {adv.title}
              </h3>
              <p className="text-[#86868b] text-[14px] font-[family-name:var(--font-inter)] leading-relaxed">
                {adv.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
