"use client";

import { useSession, signOut } from "next-auth/react";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import type { ReactNode } from "react";

export function AdminHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  const { data: session } = useSession();
  const userName = session?.user?.name || "Пользователь";

  return (
    <header className="flex h-14 lg:h-16 items-center justify-between border-b border-zinc-200 bg-white px-4 lg:px-8">
      <h1 className="truncate text-lg lg:text-xl font-semibold text-zinc-900">{title}</h1>
      <div className="flex items-center gap-2 lg:gap-4">
        {actions}
        <span className="hidden lg:inline-flex">
          <ThemeToggle />
        </span>
        <span className="hidden lg:inline-flex">
          <NotificationBell />
        </span>
        <div className="hidden lg:flex items-center gap-3 pl-3 border-l border-zinc-200">
          <span className="text-sm text-zinc-500">{userName}</span>
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="text-sm text-red-500 hover:text-red-600 transition-colors font-medium"
            title="Выйти из системы"
          >
            Выйти
          </button>
        </div>
      </div>
    </header>
  );
}
