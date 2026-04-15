"use client";

import Link from "next/link";
import { useTelegram } from "./TelegramProvider";

interface ResourceCardProps {
  id: string;
  name: string;
  description?: string | null;
  capacity?: number | null;
  pricePerHour?: string | number | null;
  imageUrl?: string | null;
  href: string;
}

export function ResourceCard({
  name,
  description,
  capacity,
  pricePerHour,
  imageUrl,
  href,
}: ResourceCardProps) {
  const { haptic } = useTelegram();

  const price = pricePerHour ? Number(pricePerHour) : null;

  return (
    <Link
      href={href}
      onClick={() => haptic.impact("light")}
      className="tg-card block"
    >
      {/* Image */}
      <div className="relative aspect-[16/9] overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center text-4xl"
            style={{ background: "var(--tg-secondary-bg)" }}
          >
            {name.includes("PS") || name.includes("Плей") ? "🎮" : "🏕"}
          </div>
        )}

        {/* Price badge */}
        {price && (
          <div className="absolute top-3 right-3 tg-badge" style={{ background: "var(--tg-button)", color: "var(--tg-button-text)" }}>
            {price.toLocaleString("ru-RU")} ₽/час
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="text-[17px] font-semibold leading-tight">{name}</h3>
        {description && (
          <p className="mt-1 text-[14px] leading-snug" style={{ color: "var(--tg-hint)" }}>
            {description}
          </p>
        )}
        {capacity && (
          <div className="mt-2 flex items-center gap-1 text-[13px]" style={{ color: "var(--tg-hint)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 00-3-3.87" />
              <path d="M16 3.13a4 4 0 010 7.75" />
            </svg>
            до {capacity} человек
          </div>
        )}
      </div>
    </Link>
  );
}
