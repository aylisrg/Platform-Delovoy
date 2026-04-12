import { NotificationBell } from "./notification-bell";

export function AdminHeader({ title }: { title: string }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-8">
      <h1 className="text-xl font-semibold text-zinc-900">{title}</h1>
      <div className="flex items-center gap-4">
        <NotificationBell />
        <span className="text-sm text-zinc-500">Администратор</span>
      </div>
    </header>
  );
}
