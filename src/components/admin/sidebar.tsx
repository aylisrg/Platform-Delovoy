"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

type NavItem = {
  label: string;
  href: string;
  icon: string;
  section: string;
};

const navigation: NavItem[] = [
  { label: "Дашборд", href: "/admin/dashboard", icon: "📊", section: "dashboard" },
  { label: "Беседки", href: "/admin/gazebos", icon: "🏕", section: "gazebos" },
  { label: "PS Park", href: "/admin/ps-park", icon: "🎮", section: "ps-park" },
  { label: "Кафе", href: "/admin/cafe", icon: "☕", section: "cafe" },
  { label: "Аренда", href: "/admin/rental", icon: "🏢", section: "rental" },
  { label: "Модули", href: "/admin/modules", icon: "📦", section: "modules" },
  { label: "Пользователи", href: "/admin/users", icon: "👥", section: "users" },
  { label: "Telegram", href: "/admin/telegram", icon: "📨", section: "telegram" },
  { label: "Мониторинг", href: "/admin/monitoring", icon: "🔍", section: "monitoring" },
  { label: "Архитектор", href: "/admin/architect", icon: "🗺", section: "architect" },
];

export function Sidebar() {
  const pathname = usePathname();
  const [allowedSections, setAllowedSections] = useState<string[] | null>(null);

  useEffect(() => {
    fetch("/api/admin/permissions/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setAllowedSections(data.data.sections);
        }
      })
      .catch(() => {
        // If fetch fails, show nothing for safety
        setAllowedSections([]);
      });
  }, []);

  const visibleNavigation =
    allowedSections === null
      ? [] // Loading — don't show anything yet
      : navigation.filter((item) => allowedSections.includes(item.section));

  return (
    <aside className="flex w-64 flex-col border-r border-zinc-200 bg-white">
      <div className="flex h-16 items-center border-b border-zinc-200 px-6">
        <Link href="/admin/dashboard" className="text-lg font-bold text-zinc-900">
          Деловой Парк
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {allowedSections === null ? (
          <div className="flex flex-col gap-2 px-3 py-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded-lg bg-zinc-100"
              />
            ))}
          </div>
        ) : (
          visibleNavigation.map((item) => {
            const isActive = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })
        )}
      </nav>

      <div className="border-t border-zinc-200 p-4 space-y-3">
        <div className="flex items-center gap-2 px-1">
          <video
            src="/media/logo-animated.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="h-6 w-6 rounded object-cover"
          />
          <span className="text-xs text-zinc-400 font-medium">Деловой Парк</span>
        </div>
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700"
        >
          ← На сайт
        </Link>
      </div>
    </aside>
  );
}
