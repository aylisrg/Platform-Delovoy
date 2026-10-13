"use client";

import { useEffect, useState, type ReactNode } from "react";
import { reachGoal } from "@/lib/metrika";

/** id секции с формой брони на /gazebos (#1085). */
export const BOOKING_SECTION_ID = "booking";
/** Событие предвыбора беседки из карточки: detail = { resourceId }. */
export const PRESELECT_EVENT = "gazebos:preselect";

export type BookingCtaSource = "hero" | "card" | "sticky";

/**
 * Клик по любой CTA онлайн-брони: цель Метрики с источником, предвыбор, скролл к форме.
 * В first-party воронку (ADR 2026-09-16) шаг не добавляем: он встал бы между
 * view и slot_selected и сломал бы конверсию (форму видят и без клика по CTA).
 */
export function handleBookingCtaClick(source: BookingCtaSource, resourceId?: string): void {
  reachGoal("gazebo_booking_start", { source });
  if (resourceId) {
    window.dispatchEvent(new CustomEvent(PRESELECT_EVENT, { detail: { resourceId } }));
  }
}

export function BookOnlineButton({
  source,
  resourceId,
  className,
  children,
}: {
  source: BookingCtaSource;
  resourceId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={`#${BOOKING_SECTION_ID}`}
      data-testid={`booking-cta-${source}`}
      onClick={() => handleBookingCtaClick(source, resourceId)}
      className={className}
    >
      {children}
    </a>
  );
}

/**
 * Липкая кнопка внизу экрана на мобильном. Прячется, когда форма брони
 * в зоне видимости (IntersectionObserver на #booking).
 */
export function StickyBookingCta() {
  const [formVisible, setFormVisible] = useState(false);

  useEffect(() => {
    const target = document.getElementById(BOOKING_SECTION_ID);
    if (!target || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setFormVisible(entry.isIntersecting), {
      threshold: 0.1,
    });
    io.observe(target);
    return () => io.disconnect();
  }, []);

  if (formVisible) return null;

  return (
    <div
      data-testid="booking-cta-sticky-bar"
      className="md:hidden fixed inset-x-0 bottom-0 z-40 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] bg-white/90 backdrop-blur border-t border-black/[0.06]"
    >
      <BookOnlineButton
        source="sticky"
        className="block w-full text-center bg-[#16A34A] hover:bg-[#15803d] text-white font-[family-name:var(--font-manrope)] font-semibold text-base py-3.5 rounded-full transition-colors"
      >
        Забронировать онлайн
      </BookOnlineButton>
    </div>
  );
}
