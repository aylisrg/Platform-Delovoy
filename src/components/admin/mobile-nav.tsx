"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ALL_NAVIGATION,
  DELOVOY_SECTIONS,
  NEDELOVOY_SECTIONS,
  detectParkFromPath,
  type ParkContext,
} from "./navigation";

const PARK_STORAGE_KEY = "admin-park-context";
const BADGE_POLL_INTERVAL = 30_000;

type MobileNavProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileNav({ open, onClose }: MobileNavProps) {
  const pathname = usePathname();
  const [allowedSections, setAllowedSections] = useState<string[] | null>(null);
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});
  const [park, setPark] = useState<ParkContext>("delovoy");

  useEffect(() => {
    const fromPath = detectParkFromPath(pathname);
    if (fromPath) {
      setPark(fromPath);
      try { localStorage.setItem(PARK_STORAGE_KEY, fromPath); } catch {}
      return;
    }
    try {
      const stored = localStorage.getItem(PARK_STORAGE_KEY) as ParkContext | null;
      if (stored === "delovoy" || stored === "nedelovoy") setPark(stored);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    fetch("/api/admin/permissions/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setAllowedSections(data.data.sections);
        else setAllowedSections([]);
      })
      .catch(() => setAllowedSections([]));
  }, []);

  useEffect(() => {
    let active = true;
    function poll() {
      fetch("/api/admin/badge-counts")
        .then((res) => res.json())
        .then((data) => { if (data.success && active) setBadgeCounts(data.data); })
        .catch(() => {});
    }
    poll();
    const interval = setInterval(poll, BADGE_POLL_INTERVAL);
    return () => { active = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!open) return null;

  const visibleSections = new Set(allowedSections ?? []);
  const parkFilter = park === "delovoy" ? DELOVOY_SECTIONS : NEDELOVOY_SECTIONS;
  const parkItems = ALL_NAVIGATION.filter((n) => parkFilter.has(n.section) && visibleSections.has(n.section)).map((item) => {
    if (item.section === "nedelovoy" && park === "nedelovoy") return { ...item, label: "Аренда" };
    return item;
  });
  const usersItem = ALL_NAVIGATION.find((n) => n.section === "users");

  const hasDelovoy = allowedSections !== null && [...visibleSections].some((s) => DELOVOY_SECTIONS.has(s));
  const hasNedelovoy = allowedSections !== null && [...visibleSections].some((s) => NEDELOVOY_SECTIONS.has(s));
  const showParkSwitcher = hasDelovoy && hasNedelovoy;

  function switchPark(next: ParkContext) {
    setPark(next);
    try { localStorage.setItem(PARK_STORAGE_KEY, next); } catch {}
  }

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Меню">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <aside className="relative z-10 flex h-full w-[84%] max-w-[320px] flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex h-16 items-center gap-2 border-b border-zinc-200 px-4">
          {showParkSwitcher ? (
            <div className="flex flex-1 items-center gap-1">
              <button
                onClick={() => switchPark("delovoy")}
                className={`rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors ${
                  park === "delovoy" ? "bg-blue-600 text-white" : "text-zinc-500 hover:bg-zinc-100"
                }`}
              >
                🏢 Деловой
              </button>
              <button
                onClick={() => switchPark("nedelovoy")}
                className={`rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors ${
                  park === "nedelovoy" ? "bg-amber-500 text-white" : "text-zinc-500 hover:bg-zinc-100"
                }`}
              >
                🏗 НеДеловой
              </button>
            </div>
          ) : (
            <Link href="/admin/dashboard" onClick={onClose} className="flex-1 text-base font-bold text-zinc-900">
              {park === "nedelovoy" ? "🏗 НеДеловой" : "🏢 Деловой Парк"}
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть меню"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Global: Users */}
        {usersItem && visibleSections.has("users") && (
          <div className="border-b border-zinc-100 px-3 py-2">
            <Link
              href="/admin/users"
              onClick={onClose}
              className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-base font-medium transition-colors ${
                pathname?.startsWith("/admin/users")
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              <span className="text-xl">👥</span>
              <span className="flex-1">Пользователи</span>
              <span className="text-xs text-zinc-400">экосистема</span>
            </Link>
          </div>
        )}

        {/* Park-specific nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {allowedSections === null ? (
            <div className="space-y-2 px-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-zinc-100" />
              ))}
            </div>
          ) : parkItems.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-400">
              Нет доступных разделов
            </p>
          ) : (
            <ul className="space-y-1">
              {parkItems.map((item) => {
                const isActive = !!pathname?.startsWith(item.href);
                const count = badgeCounts[item.section] || 0;
                return (
                  <li key={item.section}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={`flex min-h-[48px] items-center gap-3 rounded-lg px-3 py-3 text-base font-medium transition-colors ${
                        isActive ? "bg-blue-50 text-blue-700" : "text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      <span className="text-xl">{item.icon}</span>
                      <span className="flex-1">{item.label}</span>
                      {count > 0 && (
                        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-2 text-xs font-semibold text-white leading-none">
                          {count > 99 ? "99+" : count}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <div className="border-t border-zinc-200 px-5 py-4">
          <Link href="/" onClick={onClose} className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700">
            ← На сайт
          </Link>
        </div>
      </aside>
    </div>
  );
}
