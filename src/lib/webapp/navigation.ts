import type { WebAppIconName } from "./icon-names";
import type { WebAppCapabilities } from "./types";

/**
 * Единственный источник состава навигации Mini App (ADR §1).
 * Чистая функция без БД — импортируется клиентом и тестами.
 *
 * Таб «Чаты» удалён из состава (AC-1.4): для чистого Mini App пользователя
 * мессенджер требует NextAuth-cookie и вёл в тупик привязки. Страницы
 * /webapp/messenger/** остаются в коде — возврат таба = одна строка здесь.
 */

export interface WebAppTab {
  href: string;
  label: string;
  icon: WebAppIconName;
}

export interface WebAppProfileEntry {
  href: string;
  label: string;
  icon: WebAppIconName;
}

export interface WebAppNavigation {
  tabs: WebAppTab[];
  profileEntries: WebAppProfileEntry[];
}

const BASE_TABS: WebAppTab[] = [
  { href: "/webapp", label: "Главная", icon: "home" },
  { href: "/webapp/cafe", label: "Кафе", icon: "coffee" },
  { href: "/webapp/gazebos", label: "Барбекю", icon: "tent" },
  { href: "/webapp/ps-park", label: "Плей Парк", icon: "gamepad" },
  { href: "/webapp/bookings", label: "Мои брони", icon: "calendar" },
  { href: "/webapp/profile", label: "Профиль", icon: "user" },
];

export function buildNavigation(caps: WebAppCapabilities): WebAppNavigation {
  const profileEntries: WebAppProfileEntry[] = [];

  if (caps.canNotificationCenter) {
    profileEntries.push({
      href: "/webapp/notifications",
      label: "Центр уведомлений",
      icon: "bell",
    });
  }

  profileEntries.push({
    href: "/webapp/settings",
    label: "Уведомления и каналы",
    icon: "settings",
  });

  return { tabs: BASE_TABS, profileEntries };
}
