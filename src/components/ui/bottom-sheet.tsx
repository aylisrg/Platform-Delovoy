"use client";

import { useEffect, useRef, type ReactNode } from "react";

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxHeight?: string;
};

export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxHeight = "90dvh",
}: BottomSheetProps) {
  const touchStartY = useRef<number | null>(null);
  const touchCurrentY = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  function handleTouchStart(e: React.TouchEvent) {
    touchStartY.current = e.touches[0].clientY;
    touchCurrentY.current = e.touches[0].clientY;
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (touchStartY.current === null) return;
    const y = e.touches[0].clientY;
    touchCurrentY.current = y;
    const delta = y - touchStartY.current;
    if (delta > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${delta}px)`;
    }
  }

  function handleTouchEnd() {
    if (touchStartY.current === null || touchCurrentY.current === null) {
      touchStartY.current = null;
      touchCurrentY.current = null;
      return;
    }
    const delta = touchCurrentY.current - touchStartY.current;
    if (sheetRef.current) sheetRef.current.style.transform = "";
    touchStartY.current = null;
    touchCurrentY.current = null;
    if (delta > 80) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className="relative z-10 flex flex-col w-full rounded-t-2xl bg-white shadow-2xl transition-transform duration-150"
        style={{ maxHeight }}
      >
        <div
          className="flex flex-col items-center pt-2 pb-1 cursor-grab touch-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="h-1.5 w-10 rounded-full bg-zinc-300" />
        </div>

        {(title || subtitle) && (
          <div className="flex items-start justify-between px-5 pt-2 pb-3 border-b border-zinc-100">
            <div className="min-w-0">
              {title && (
                <h3 className="text-base font-semibold text-zinc-900 truncate">{title}</h3>
              )}
              {subtitle && (
                <p className="mt-0.5 text-xs text-zinc-500 truncate">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              className="flex h-11 w-11 -mr-2 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M4 4l12 12M16 4L4 16"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="sticky bottom-0 border-t border-zinc-100 bg-white px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
