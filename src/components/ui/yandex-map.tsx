import React from "react";

export function buildYandexEmbedUrl(
  lat: number,
  lon: number,
  zoom: number,
  orgId?: string,
): string {
  // pt= рисует красный pin (pm2rdl) — гарантированно виден в map-widget/v1.
  // oid= добавляет карточку организации при клике (открывается поверх карты).
  // Без pt= маркер не отображается, даже если oid передан.
  const base =
    `https://yandex.ru/map-widget/v1/?ll=${lon}%2C${lat}` +
    `&z=${zoom}&pt=${lon}%2C${lat}%2Cpm2rdl&l=map&lang=ru_RU`;
  return orgId ? `${base}&oid=${orgId}` : base;
}

export function buildYandexOpenUrl(
  lat: number,
  lon: number,
  zoom: number,
  orgId?: string,
): string {
  if (orgId) {
    // Открываем страницу организации в Яндекс Картах.
    return `https://yandex.ru/maps/org/${orgId}/?ll=${lon}%2C${lat}&z=${zoom}`;
  }
  // Без org — открываем построение маршрута до точки.
  return (
    `https://yandex.ru/maps/?ll=${lon}%2C${lat}` +
    `&z=${zoom}&pt=${lon}%2C${lat}&mode=routes&rtext=~${lat}%2C${lon}&rtt=auto`
  );
}

export interface YandexMapProps {
  lat: number;
  lon: number;
  zoom?: number;
  title: string;
  theme?: "light" | "dark";
  className?: string;
  showRouteCta?: boolean;
  ctaLabel?: string;
  /**
   * Yandex organization ID (oid). Когда указан — карта показывает карточку
   * организации (с её родным маркером), а CTA ведёт на /maps/org/<id>/.
   * Без orgId — рисуется pt-маркер по координатам, CTA строит маршрут.
   */
  orgId?: string;
}

const wrapperByTheme = {
  light:
    "bg-[#f5f5f7] ring-1 ring-black/5 shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.12)]",
  dark: "bg-zinc-900 ring-1 ring-zinc-800",
} as const;

const ctaByTheme = {
  light:
    "bg-[#f5f5f7] hover:bg-[#ebebed] text-[#1d1d1f] font-[family-name:var(--font-inter)]",
  dark:
    "bg-zinc-900 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-zinc-800 font-[family-name:var(--font-manrope)]",
} as const;

const ctaArrowByTheme = {
  light: "text-[#86868b]",
  dark: "text-zinc-500",
} as const;

export function YandexMap({
  lat,
  lon,
  zoom = 16,
  title,
  theme = "light",
  className,
  showRouteCta = true,
  ctaLabel,
  orgId,
}: YandexMapProps) {
  const embedUrl = buildYandexEmbedUrl(lat, lon, zoom, orgId);
  const openUrl = buildYandexOpenUrl(lat, lon, zoom, orgId);
  const resolvedCtaLabel =
    ctaLabel ?? (orgId ? "Открыть в Яндекс Картах" : "Построить маршрут в Яндекс Картах");

  const wrapperBase =
    "relative w-full overflow-hidden rounded-3xl transition-shadow";
  const wrapperClass = `${wrapperBase} ${wrapperByTheme[theme]}`;
  const containerClass = className
    ? `${wrapperClass} ${className}`
    : `${wrapperClass} aspect-[4/3] min-h-[400px]`;

  return (
    <div className="flex flex-col gap-4">
      <div className={containerClass}>
        <iframe
          src={embedUrl}
          title={title}
          aria-label={title}
          loading="lazy"
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
      {showRouteCta && (
        <a
          href={openUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={resolvedCtaLabel}
          className={`inline-flex items-center gap-2 self-start rounded-full px-5 py-3 text-sm font-medium transition-colors ${ctaByTheme[theme]}`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 22s-8-7.5-8-13a8 8 0 0 1 16 0c0 5.5-8 13-8 13z" />
            <circle cx="12" cy="9" r="3" />
          </svg>
          {resolvedCtaLabel}
          <svg
            className={`w-3.5 h-3.5 ${ctaArrowByTheme[theme]}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </a>
      )}
    </div>
  );
}
