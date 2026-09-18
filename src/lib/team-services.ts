import type { Role } from "@prisma/client";

/**
 * Каталог внутренних сервисов для страницы «Для команды» (`/for-team`).
 *
 * Здесь только то, что РАБОТАЕТ сегодня: у каждой записи есть живая страница
 * в админке. Заглушки в каталог не попадают — «Бани» (`sauna`) числятся в
 * навигации и в гриде прав, но страницы `/admin/sauna` в проекте нет, поэтому
 * сюда они не включены (см. CLAUDE.md, модуль `sauna` — 🟡 stub).
 *
 * Видимость карточки обязана совпадать с реальным гейтом из
 * `auth.config.ts → authorized()`, иначе команда будет упираться в
 * `/admin/forbidden`:
 *   - SUPERADMIN проходит на любой `/admin/*`;
 *   - ADMIN и MANAGER — только на секции из своих `adminSections`.
 *
 * `superadminOnly` — про три секции (`payments`, `feedback`, `notifications`),
 * которых нет в `ADMIN_SECTIONS` из `permissions.ts`. Их нельзя выдать
 * ADMIN/MANAGER в принципе: `setUserAdminSections()` отфильтрует такой slug,
 * и `authorized()` отправит пользователя на `/admin/forbidden`. Фактически они
 * доступны только SUPERADMIN — так и показываем.
 */
export type TeamServiceGroup =
  | "Операции парка"
  | "Клиенты и продажи"
  | "Ресурсы и деньги"
  | "Работа команды"
  | "Система";

export type TeamService = {
  /** Slug секции админки — совпадает с первым сегментом `/admin/{section}`. */
  section: string;
  label: string;
  description: string;
  href: string;
  icon: string;
  group: TeamServiceGroup;
  /** Секция вне грида прав — выдать её ADMIN/MANAGER невозможно. */
  superadminOnly?: boolean;
};

export const TEAM_SERVICES: TeamService[] = [
  {
    section: "dashboard",
    label: "Дашборд",
    description: "Сводка по парку: брони, заказы, выручка за день.",
    href: "/admin/dashboard",
    icon: "📊",
    group: "Операции парка",
  },
  {
    section: "gazebos",
    label: "Барбекю Парк",
    description: "Брони беседок, расписание, перенос и отмена.",
    href: "/admin/gazebos",
    icon: "🏕",
    group: "Операции парка",
  },
  {
    section: "ps-park",
    label: "Плей Парк",
    description: "Сеансы PlayStation, столы, абонементы и смены.",
    href: "/admin/ps-park",
    icon: "🎮",
    group: "Операции парка",
  },
  {
    section: "cafe",
    label: "Кафе",
    description: "Меню, заказы и статистика продаж.",
    href: "/admin/cafe",
    icon: "☕",
    group: "Операции парка",
  },
  {
    section: "rental",
    label: "Аренда офисов",
    description: "Офисы, договоры и сделки парка Деловой.",
    href: "/admin/rental",
    icon: "🏢",
    group: "Операции парка",
  },
  {
    section: "nedelovoy",
    label: "НеДеловой",
    description: "Аренда офисов второго парка. Доступ выдаётся отдельно.",
    href: "/admin/nedelovoy",
    icon: "🏗",
    group: "Операции парка",
  },
  {
    section: "clients",
    label: "Гости (CRM)",
    description: "Карточки гостей и арендаторов, история обращений.",
    href: "/admin/clients",
    icon: "🧑",
    group: "Клиенты и продажи",
  },
  {
    section: "avito",
    label: "Деловой Авито",
    description: "Объявления и переписка с площадки Авито.",
    href: "/admin/avito",
    icon: "📣",
    group: "Клиенты и продажи",
  },
  {
    section: "feedback",
    label: "Обратная связь",
    description: "Отзывы и обращения пользователей, привязка к офисам.",
    href: "/admin/feedback",
    icon: "💬",
    group: "Клиенты и продажи",
    superadminOnly: true,
  },
  {
    section: "payments",
    label: "Платежи",
    description: "Онлайн-оплаты ЮKassa, сверка и возвраты.",
    href: "/admin/payments",
    icon: "💳",
    group: "Ресурсы и деньги",
    superadminOnly: true,
  },
  {
    section: "inventory",
    label: "Склад",
    description: "Остатки, поставки и списания по модулям.",
    href: "/admin/inventory",
    icon: "📋",
    group: "Ресурсы и деньги",
  },
  {
    section: "management",
    label: "Управленка",
    description: "Расходы парка и управленческий учёт.",
    href: "/admin/management",
    icon: "💰",
    group: "Ресурсы и деньги",
  },
  {
    section: "analytics",
    label: "Аналитика",
    description: "Метрики, воронки и конверсии по направлениям.",
    href: "/admin/analytics",
    icon: "📈",
    group: "Ресурсы и деньги",
  },
  {
    section: "tasks",
    label: "Задачи",
    description: "Канбан: внутренние задачи и заявки арендаторов.",
    href: "/admin/tasks",
    icon: "📌",
    group: "Работа команды",
  },
  {
    section: "messenger",
    label: "Мессенджер",
    description: "Чаты с гостями и внутренние переписки команды.",
    href: "/admin/messenger",
    icon: "💬",
    group: "Работа команды",
  },
  {
    section: "notifications",
    label: "Уведомления",
    description: "Маршруты уведомлений, каналы и тестовые отправки.",
    href: "/admin/notifications",
    icon: "🔔",
    group: "Работа команды",
    superadminOnly: true,
  },
  {
    section: "users",
    label: "Пользователи",
    description: "Сотрудники, роли и доступы к разделам.",
    href: "/admin/users",
    icon: "👥",
    group: "Система",
  },
  {
    section: "modules",
    label: "Модули",
    description: "Состав платформы и настройки модулей.",
    href: "/admin/modules",
    icon: "📦",
    group: "Система",
  },
  {
    section: "monitoring",
    label: "Мониторинг",
    description: "Здоровье сервисов, события и инциденты.",
    href: "/admin/monitoring",
    icon: "🔍",
    group: "Система",
  },
  {
    section: "architect",
    label: "Архитектор",
    description: "Карта системы, логи, бэкапы и деплой.",
    href: "/admin/architect",
    icon: "🗺",
    group: "Система",
  },
];

export const TEAM_SERVICE_GROUP_ORDER: TeamServiceGroup[] = [
  "Операции парка",
  "Клиенты и продажи",
  "Ресурсы и деньги",
  "Работа команды",
  "Система",
];

/** Роли, для которых страница «Для команды» вообще имеет смысл. */
export function isTeamRole(role: Role | string | null | undefined): boolean {
  return role === "SUPERADMIN" || role === "ADMIN" || role === "MANAGER";
}

/**
 * Сервисы, до которых конкретный сотрудник реально дойдёт.
 *
 * `grantedSections` — результат `getUserAdminSections(userId)`: для SUPERADMIN
 * это все несекретные секции грида (+ строгие, если выданы явно), для
 * ADMIN/MANAGER — только явные `AdminPermission`.
 */
export function visibleTeamServices(
  role: Role | string | null | undefined,
  grantedSections: string[],
): TeamService[] {
  if (!isTeamRole(role)) return [];
  const granted = new Set(grantedSections);
  return TEAM_SERVICES.filter((service) => {
    // Секции вне грида прав — только SUPERADMIN, и никакой грант этого не
    // меняет: `authorized()` всё равно отправит ADMIN/MANAGER на
    // /admin/forbidden, так что ссылка была бы заведомо битой.
    if (service.superadminOnly) return role === "SUPERADMIN";
    return granted.has(service.section);
  });
}

/** Группировка отфильтрованных сервисов в порядке `TEAM_SERVICE_GROUP_ORDER`. */
export function groupTeamServices(
  services: TeamService[],
): { group: TeamServiceGroup; services: TeamService[] }[] {
  return TEAM_SERVICE_GROUP_ORDER.map((group) => ({
    group,
    services: services.filter((s) => s.group === group),
  })).filter((entry) => entry.services.length > 0);
}
