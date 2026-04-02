"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
  icon: string;
};

const navigation: NavItem[] = [
  { label: "Дашборд", href: "/admin/dashboard", icon: "📊" },
  { label: "Беседки", href: "/admin/gazebos", icon: "🏕" },
  { label: "PS Park", href: "/admin/ps-park", icon: "🎮" },
  { label: "Модули", href: "/admin/modules", icon: "📦" },
  { label: "Пользователи", href: "/admin/users", icon: "👥" },
  { label: "Мониторинг", href: "/admin/monitoring", icon: "🔍" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 flex-col border-r border-zinc-200 bg-white">
      <div className="flex h-16 items-center border-b border-zinc-200 px-6">
        <Link href="/admin/dashboard" className="text-lg font-bold text-zinc-900">
          Деловой Парк
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {navigation.map((item) => {
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
        })}
      </nav>

      <div className="border-t border-zinc-200 p-4">
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
