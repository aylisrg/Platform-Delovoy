"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavItem = {
  label: string;
  href: string;
  icon: string;
  section: string;
};

const ALL_NAVIGATION: NavItem[] = [
  { label: "Дашборд", href: "/admin/dashboard", icon: "📊", section: "dashboard" },
  { label: "Барбекю Парк", href: "/admin/gazebos", icon: "🏕", section: "gazebos" },
  { label: "Плей Парк", href: "/admin/ps-park", icon: "🎮", section: "ps-park" },
  { label: "Кафе", href: "/admin/cafe", icon: "☕", section: "cafe" },
  { label: "Аренда", href: "/admin/rental", icon: "🏢", section: "rental" },
  { label: "Модули", href: "/admin/modules", icon: "📦", section: "modules" },
  { label: "Пользователи", href: "/admin/users", icon: "👥", section: "users" },
  { label: "Клиенты", href: "/admin/clients", icon: "👤", section: "clients" },
  { label: "Telegram", href: "/admin/telegram", icon: "📨", section: "telegram" },
  { label: "Склад", href: "/admin/inventory", icon: "📋", section: "inventory" },
  { label: "Аналитика", href: "/admin/analytics", icon: "📈", section: "analytics" },
  { label: "Обратная связь", href: "/admin/feedback", icon: "💬", section: "feedback" },
  { label: "Мониторинг", href: "/admin/monitoring", icon: "🔍", section: "monitoring" },
  { label: "Архитектор", href: "/admin/architect", icon: "🗺", section: "architect" },
];

const BADGE_POLL_INTERVAL = 30_000;

type MobileNavProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileNav({ open, onClose }: MobileNavProps) {
  const pathname = usePathname();
  const [allowedSections, setAllowedSections] = useState<string[] | null>(null);
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});

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
        .then((data) => {
          if (data.success && active) setBadgeCounts(data.data);
        })
        .catch(() => {});
    }
    poll();
    const interval = setInterval(poll, BADGE_POLL_INTERVAL);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  // Lock body scroll and handle escape while drawer is open
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

  // Auto-close on route change
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!open) return null;

  const visibleSections = new Set(allowedSections ?? []);
  const visibleItems = ALL_NAVIGATION.filter((n) => visibleSections.has(n.section));

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Меню">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <aside className="relative z-10 flex h-full w-[84%] max-w-[320px] flex-col bg-white shadow-2xl">
        <div className="flex h-16 items-center justify-between border-b border-zinc-200 px-5">
          <Link href="/admin/dashboard" onClick={onClose} className="text-lg font-bold text-zinc-900">
            Деловой Парк
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть меню"
            className="flex h-11 w-11 -mr-2 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
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

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {allowedSections === null ? (
            <div className="space-y-2 px-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-zinc-100" />
              ))}
            </div>
          ) : visibleItems.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-zinc-400">
              Нет доступных разделов
            </p>
          ) : (
            <ul className="space-y-1">
              {visibleItems.map((item) => {
                const isActive = !!pathname?.startsWith(item.href);
                const count = badgeCounts[item.section] || 0;
                return (
                  <li key={item.section}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={`flex min-h-[48px] items-center gap-3 rounded-lg px-3 py-3 text-base font-medium transition-colors ${
                        isActive
                          ? "bg-blue-50 text-blue-700"
                          : "text-zinc-700 hover:bg-zinc-50"
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
          <Link
            href="/"
            onClick={onClose}
            className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700"
          >
            ← На сайт
          </Link>
        </div>
      </aside>
    </div>
  );
}
