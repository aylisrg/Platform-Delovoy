import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserAdminSections } from "@/lib/permissions";
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
 * Категории каталога, доступные пользователю:
 * - секционный доступ: хотя бы одна секция категории входит в его секции;
 * - superadminAlways: роль SUPERADMIN (кроме strict-access — те приходят
 *   только через getUserAdminSections);
 * - grandfather (ADR §4): категория видна и тогда, когда у пользователя уже
 *   есть явная строка предпочтения по её событию — унаследованный подписчик
 *   не должен оказаться в ловушке «получаю, но не могу отключить».
 *
 * Используется и в capabilities (навигация), и в Центре уведомлений —
 * единые правила видимости.
 */
export async function resolveManagedCategories(
  user: { id: string; role: Role },
  sections: string[]
): Promise<ManagedCategory[]> {
  const accessible = NOTIFICATION_CATALOG.filter(
    (category) =>
      category.sections.some((section) => sections.includes(section)) ||
      (category.superadminAlways === true && user.role === "SUPERADMIN")
  );

  const missing = NOTIFICATION_CATALOG.filter(
    (category) => !accessible.includes(category)
  );
  if (missing.length === 0) return accessible;

  const missingEventTypes = missing.flatMap((category) =>
    category.events.map((event) => event.eventType)
  );
  const explicitRows = await prisma.notificationEventPreference.findMany({
    where: { userId: user.id, eventType: { in: missingEventTypes } },
    select: { eventType: true },
  });
  if (explicitRows.length === 0) return accessible;

  const grandfathered = new Set(explicitRows.map((row) => row.eventType));
  const inherited = missing.filter((category) =>
    category.events.some((event) => grandfathered.has(event.eventType))
  );

  // Порядок каталога сохраняем — UI рисует категории стабильно.
  return NOTIFICATION_CATALOG.filter(
    (category) => accessible.includes(category) || inherited.includes(category)
  );
}

export async function getWebAppCapabilities(user: {
  id: string;
  role: Role;
}): Promise<WebAppCapabilities> {
  // USER — без запросов в БД: гостю ничего сотруднического не положено.
  if (user.role === "USER") return GUEST_CAPABILITIES;

  const sections = await getUserAdminSections(user.id);
  const categories = await resolveManagedCategories(user, sections);

  return {
    isStaff: true,
    staffSections: sections,
    notificationCategories: categories.map((category) => category.key),
    canNotificationCenter: categories.length > 0,
  };
}
