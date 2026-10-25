import Link from "next/link";

/**
 * Tab links of the «Уведомления» section (ADR 2026-10-25 §7 «Навигация
 * уведомлений»). Matrix and Stats are SUPERADMIN-only — the pages check the
 * role themselves too; the links are hidden so nobody runs into /forbidden.
 */

export type NotificationsTab = "routing" | "matrix" | "stats" | "broadcast";

const TABS: Array<{ key: NotificationsTab; label: string; href: string; superadminOnly?: boolean }> = [
  { key: "routing", label: "Маршрутизация", href: "/admin/notifications" },
  { key: "matrix", label: "Матрица", href: "/admin/notifications/matrix", superadminOnly: true },
  { key: "stats", label: "Статистика", href: "/admin/notifications/stats", superadminOnly: true },
  { key: "broadcast", label: "Рассылка", href: "/admin/notifications/broadcast" },
];

export function NotificationsTabs({ active, isSuperadmin }: { active: NotificationsTab; isSuperadmin: boolean }) {
  return (
    <nav aria-label="Разделы уведомлений" className="flex flex-wrap gap-1 border-b border-zinc-200">
      {TABS.filter((tab) => !tab.superadminOnly || isSuperadmin).map((tab) => {
        const current = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              current
                ? "border-zinc-900 text-zinc-900"
                : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
