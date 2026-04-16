import { NotificationBell } from "./notification-bell";
import type { ReactNode } from "react";

export function AdminHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="flex h-14 lg:h-16 items-center justify-between border-b border-zinc-200 bg-white px-4 lg:px-8">
      <h1 className="truncate text-lg lg:text-xl font-semibold text-zinc-900">{title}</h1>
      <div className="flex items-center gap-2 lg:gap-4">
        {actions}
        <span className="hidden lg:inline-flex">
          <NotificationBell />
        </span>
        <span className="hidden lg:inline text-sm text-zinc-500">Администратор</span>
      </div>
    </header>
  );
}
