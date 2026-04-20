"use client";

import Link from "next/link";
import { useState } from "react";
import { MobileNav } from "./mobile-nav";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";

/**
 * Top bar visible only on < lg screens (mobile + tablet).
 * Contains: hamburger → MobileNav drawer, title, notification bell.
 *
 * On lg+ this component is entirely hidden via `lg:hidden`; the desktop
 * Sidebar takes over.
 */
export function MobileTopBar() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-3 lg:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          aria-label="Открыть меню"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-700 hover:bg-zinc-100"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 6h16M4 12h16M4 18h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <Link href="/admin/dashboard" className="text-base font-semibold text-zinc-900">
          Деловой Парк
        </Link>

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <NotificationBell />
        </div>
      </header>

      <MobileNav open={navOpen} onClose={() => setNavOpen(false)} />
    </>
  );
}
