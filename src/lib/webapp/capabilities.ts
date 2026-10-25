import type { Role } from "@prisma/client";
import { getUserAdminSections } from "@/lib/permissions";
import { loadStaffSnapshots } from "@/modules/notifications/audience";
import { hasEventAccess } from "@/modules/notifications/subscriptions";
import {
  NOTIFICATION_CATALOG,
  type ManagedCategory,
} from "@/modules/notifications/catalog";

/**
 * Возможности пользователя в Mini App (ADR §1).
 * Возвращаются ответом POST /api/webapp/auth для рендера навигации —
 * один round-trip, без мигания (AC-1.6). Для чувствительных операций
 * staff-роуты НЕ доверяют этому снимку и перечитывают права из БД
 * (loadWebAppStaff, AC-1.5).
 *
 * Тип и гостевой дефолт — в клиент-безопасном `./types` (этот файл
 * импортирует prisma и в клиентский бандл попадать не должен).
 */
import { GUEST_CAPABILITIES, type WebAppCapabilities } from "./types";

export type { WebAppCapabilities };
export { GUEST_CAPABILITIES };

/**
 * Категории каталога, доступные пользователю — то же правило доступа, что у
 * реальной рассылки (`contextAccess`, ADR 2026-10-25-team-access-notifications
 * §Q7): доступ хотя бы в одном контексте модуля. Прежний «grandfather» (видна
 * без доступа, если есть строка предпочтения) убран: без доступа доставки нет,
 * ловушки «получаю, но не могу отключить» больше не существует.
 */
export async function resolveManagedCategories(user: { id: string; role: Role }): Promise<ManagedCategory[]> {
  if (user.role === "USER") return [];
  const [snapshot] = await loadStaffSnapshots({ userIds: [user.id] });
  if (!snapshot) return [];
  return NOTIFICATION_CATALOG.filter((category) =>
    category.events.some((event) => hasEventAccess(snapshot, event.eventType))
  );
}

export async function getWebAppCapabilities(user: {
  id: string;
  role: Role;
}): Promise<WebAppCapabilities> {
  // USER — без запросов в БД: гостю ничего сотруднического не положено.
  if (user.role === "USER") return GUEST_CAPABILITIES;

  const [sections, categories] = await Promise.all([
    getUserAdminSections(user.id),
    resolveManagedCategories(user),
  ]);

  return {
    isStaff: true,
    staffSections: sections,
    notificationCategories: categories.map((category) => category.key),
    canNotificationCenter: categories.length > 0,
  };
}
