"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTelegram } from "./TelegramProvider";
import { buildNavigation } from "@/lib/webapp/navigation";
import { Icon } from "./ui/Icon";
import { Skeleton } from "./ui/Skeleton";

/**
 * Нижняя навигация Mini App. Состав — единственный источник:
 * buildNavigation(capabilities) (ADR §1). До ready рисуем скелет,
 * чтобы не мигать чужим составом разделов (AC-1.6).
 */
export function TabBar() {
  const pathname = usePathname();
  const { ready, capabilities, haptic } = useTelegram();

  if (!ready) {
    return (
      <nav className="webapp-tabbar">
        <div className="flex items-center justify-around py-2 px-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-1 py-1 px-3 min-w-[52px]"
            >
              <Skeleton className="w-6 h-6 rounded-full" />
              <Skeleton className="w-9 h-2.5 rounded" />
            </div>
          ))}
        </div>
      </nav>
    );
  }

  const { tabs } = buildNavigation(capabilities);

  return (
    <nav className="webapp-tabbar">
      <div className="flex items-center justify-around py-2 px-1">
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/webapp"
              ? pathname === "/webapp"
              : pathname.startsWith(tab.href);
          const color = isActive ? "var(--tg-button)" : "var(--tg-hint)";

          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => haptic.selection()}
              className="flex flex-col items-center gap-0.5 py-1 px-2 min-w-[52px]"
              style={{ color }}
            >
              <Icon name={tab.icon} size={24} />
              <span className="text-[10px] font-medium" style={{ color }}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
