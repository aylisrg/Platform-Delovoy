"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTelegram } from "./TelegramProvider";

const tabs = [
  {
    href: "/webapp",
    label: "Главная",
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--tg-button)" : "var(--tg-hint)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    href: "/webapp/gazebos",
    label: "Беседки",
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--tg-button)" : "var(--tg-hint)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7h20L12 2z" />
        <path d="M2 7v10" />
        <path d="M22 7v10" />
        <path d="M6 17v4" />
        <path d="M18 17v4" />
        <line x1="2" y1="17" x2="22" y2="17" />
      </svg>
    ),
  },
  {
    href: "/webapp/ps-park",
    label: "Плей Парк",
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--tg-button)" : "var(--tg-hint)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <line x1="6" y1="12" x2="10" y2="12" />
        <line x1="8" y1="10" x2="8" y2="14" />
        <circle cx="16" cy="10" r="1" fill={active ? "var(--tg-button)" : "var(--tg-hint)"} />
        <circle cx="18" cy="13" r="1" fill={active ? "var(--tg-button)" : "var(--tg-hint)"} />
      </svg>
    ),
  },
  {
    href: "/webapp/bookings",
    label: "Мои брони",
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--tg-button)" : "var(--tg-hint)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M8 14l2 2 4-4" />
      </svg>
    ),
  },
  {
    href: "/webapp/profile",
    label: "Профиль",
    icon: (active: boolean) => (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? "var(--tg-button)" : "var(--tg-hint)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
];

export function TabBar() {
  const pathname = usePathname();
  const { haptic } = useTelegram();

  return (
    <nav className="webapp-tabbar">
      <div className="flex items-center justify-around py-2 px-1">
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/webapp"
              ? pathname === "/webapp"
              : pathname.startsWith(tab.href);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => haptic.selection()}
              className="flex flex-col items-center gap-0.5 py-1 px-3 min-w-[56px]"
            >
              {tab.icon(isActive)}
              <span
                className="text-[10px] font-medium"
                style={{ color: isActive ? "var(--tg-button)" : "var(--tg-hint)" }}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
