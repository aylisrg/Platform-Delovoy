import { NotificationBell } from "./notification-bell";
import type { ReactNode } from "react";

export function AdminHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
      <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
      <div className="flex items-center gap-4">
        {actions}
        <NotificationBell />
        <span className="text-sm text-zinc-500">Администратор</span>
      </div>
    </header>
  );
}
