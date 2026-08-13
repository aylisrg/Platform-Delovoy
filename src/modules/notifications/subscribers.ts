import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { STRICT_ACCESS_MODULES } from "@/lib/permissions";

/**
 * Резолвер «самоподписанных» получателей staff-событий (ADR
 * `2026-08-13-miniapp-role-rebuild` §3.3).
 *
 * Принцип явной подписки: строка `NotificationEventPreference(enabled=true)`
 * = персональная подписка сотрудника, отсутствие строки = подписки нет.
 * Дефолт `enabled: true` внутри `dispatch()` при этом не трогается — он
 * обслуживает события, адресованные лично субъекту (бронь гостя, сообщение,
 * задача), где «включено по умолчанию» и есть правильное поведение.
 *
 * Доступ проверяется теми же правилами, что `hasAdminSectionAccess`, но одним
 * батчем: строки `AdminPermission` приезжают вместе с подписками, SUPERADMIN
 * проходит по роли — кроме strict-access секций, где грант обязателен всем.
 */

type SubscriberRow = {
  userId: string;
  user: {
    role: Role;
    adminPermissions: Array<{ section: string }>;
  } | null;
};

function hasAnyRequiredSection(
  user: SubscriberRow["user"],
  requiredSections: string[]
): boolean {
  if (!user) return false;
  const granted = new Set(user.adminPermissions.map((p) => p.section));

  return requiredSections.some((section) => {
    if (granted.has(section)) return true;
    // SUPERADMIN — всегда, кроме strict-access секций (нужен явный грант).
    return user.role === "SUPERADMIN" && !STRICT_ACCESS_MODULES.has(section);
  });
}

/**
 * Пользователи, которые сами подписались на `eventType` и при этом имеют
 * доступ хотя бы к одной из секций категории события.
 *
 * Пустой список требуемых секций = событие вне каталога Центра: подписок по
 * нему быть не может, лишний запрос в БД не делаем и никого не добавляем
 * (поведение `notifyAdmin` для неуправляемых типов не меняется).
 */
export async function getSelfSubscribedUserIds(
  eventType: string,
  requiredSections: string[]
): Promise<string[]> {
  if (requiredSections.length === 0) return [];

  const rows: SubscriberRow[] = await prisma.notificationEventPreference.findMany({
    where: {
      eventType,
      enabled: true,
      // Разжалованный или слитый аккаунт перестаёт получать немедленно,
      // не дожидаясь чистки строк предпочтений.
      user: { role: { not: "USER" }, mergedIntoUserId: null },
    },
    select: {
      userId: true,
      user: {
        select: {
          role: true,
          adminPermissions: { select: { section: true } },
        },
      },
    },
  });

  const allowed = rows
    .filter((row) => hasAnyRequiredSection(row.user, requiredSections))
    .map((row) => row.userId);

  return [...new Set(allowed)];
}
