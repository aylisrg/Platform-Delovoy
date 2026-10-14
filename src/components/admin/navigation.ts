/**
 * Единый список пунктов админ-меню для сайдбара и мобильной навигации.
 *
 * Каждый пункт обязан:
 *   - иметь страницу `src/app/admin/<section>/page.tsx` (иначе ссылка даёт 404);
 *   - быть в `ADMIN_SECTIONS` из `src/lib/permissions.ts` (иначе
 *     `getUserAdminSections()` его не вернёт и меню пункт не покажет).
 * Оба условия проверяет `src/components/admin/__tests__/navigation.test.ts`.
 *
 * «Бани» (`sauna`) сюда не входят: модуль-заглушка, страницы в админке нет
 * (см. #915). Вернуть пункт вместе с реальной страницей.
 */
export type NavItem = {
  label: string;
  href: string;
  icon: string;
  section: string;
};

export type ParkContext = "delovoy" | "nedelovoy";

export const ALL_NAVIGATION: NavItem[] = [
  { label: "Дашборд", href: "/admin/dashboard", icon: "📊", section: "dashboard" },
  { label: "Барбекю Парк", href: "/admin/gazebos", icon: "🏕", section: "gazebos" },
  { label: "Плей Парк", href: "/admin/ps-park", icon: "🎮", section: "ps-park" },
  { label: "Кафе", href: "/admin/cafe", icon: "☕", section: "cafe" },
  { label: "Аренда", href: "/admin/rental", icon: "🏢", section: "rental" },
  { label: "НеДеловой", href: "/admin/nedelovoy", icon: "🏗", section: "nedelovoy" },
  { label: "Модули", href: "/admin/modules", icon: "📦", section: "modules" },
  { label: "Пользователи", href: "/admin/users", icon: "👥", section: "users" },
  { label: "Гости (CRM)", href: "/admin/clients", icon: "🧑", section: "clients" },
  { label: "Склад", href: "/admin/inventory", icon: "📋", section: "inventory" },
  { label: "Аналитика", href: "/admin/analytics", icon: "📈", section: "analytics" },
  { label: "Платежи", href: "/admin/payments", icon: "💳", section: "payments" },
  { label: "Управленка", href: "/admin/management", icon: "💰", section: "management" },
  { label: "Обратная связь", href: "/admin/feedback", icon: "💬", section: "feedback" },
  { label: "Задачи", href: "/admin/tasks", icon: "📌", section: "tasks" },
  { label: "Мессенджер", href: "/admin/messenger", icon: "💬", section: "messenger" },
  { label: "Деловой Авито", href: "/admin/avito", icon: "📣", section: "avito" },
  { label: "Уведомления", href: "/admin/notifications", icon: "🔔", section: "notifications" },
  { label: "Мониторинг", href: "/admin/monitoring", icon: "🔍", section: "monitoring" },
  { label: "Архитектор", href: "/admin/architect", icon: "🗺", section: "architect" },
];

// Секции каждого парка. "users" — глобальная, закреплена над меню парка.
export const DELOVOY_SECTIONS = new Set([
  "dashboard", "rental", "gazebos", "ps-park", "cafe",
  "clients", "inventory", "analytics", "payments", "management",
  "feedback", "tasks", "messenger", "avito", "notifications", "monitoring",
  "architect", "modules",
]);
export const NEDELOVOY_SECTIONS = new Set(["nedelovoy"]);

export function detectParkFromPath(pathname: string | null): ParkContext | null {
  if (!pathname) return null;
  if (pathname.startsWith("/admin/nedelovoy")) return "nedelovoy";
  const isDelovoy = ALL_NAVIGATION.some(
    (n) => DELOVOY_SECTIONS.has(n.section) && pathname.startsWith(n.href),
  );
  return isDelovoy ? "delovoy" : null;
}
