import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WebAppStaffContext } from "@/lib/webapp-auth";
import { resolveManagedCategories } from "@/lib/webapp/capabilities";
import type { WebAppIconName } from "@/lib/webapp/icon-names";
import {
  MANAGED_EVENT_TYPES,
  categoryForEvent,
  type ManagedCategory,
} from "./catalog";
import {
  getPreferences,
  upsertEventPreference,
} from "./dispatch/preferences-service";
import { RELEASE_EVENT_TYPE, setReleaseSubscription } from "./release-notify";

/**
 * Центр уведомлений сотрудника в Mini App (ADR
 * `2026-08-13-miniapp-role-rebuild` §3.3, §5).
 *
 * Роут только парсит и возвращает — вся логика видимости категорий,
 * автопровижининга канала и записи предпочтений живёт здесь.
 */

export class CenterError extends Error {
  constructor(
    readonly code: "FORBIDDEN" | "VALIDATION_ERROR",
    message: string,
    readonly status: 403 | 422
  ) {
    super(message);
    this.name = "CenterError";
  }
}

export type NotificationCenterChannel = {
  kind: "TELEGRAM";
  status: "active" | "inactive";
  /** Канал создан/верифицирован прямо этим запросом */
  provisionedNow: boolean;
};

export type NotificationCenterEvent = {
  eventType: string;
  label: string;
  description: string;
  enabled: boolean;
  /** explicit — есть строка предпочтения; default — строки нет */
  source: "explicit" | "default";
};

export type NotificationCenterCategory = {
  key: string;
  label: string;
  description: string;
  icon: WebAppIconName;
  delivery: "personal" | "group";
  events: NotificationCenterEvent[];
};

export type NotificationCenterProtectedNotice = {
  label: string;
  note: string;
};

export type NotificationCenterView = {
  role: Role;
  channel: NotificationCenterChannel;
  categories: NotificationCenterCategory[];
  protected: NotificationCenterProtectedNotice[];
};

/**
 * Неотключаемое — показывается строкой-пояснением в категории «Системные».
 * Инфраструктурные CRITICAL-алерты не проходят через dispatch()/предпочтения
 * физически, тумблера за ними нет и быть не может (AC-5.7).
 */
export const PROTECTED_NOTICES: NotificationCenterProtectedNotice[] = [
  {
    label: "Критические алерты инфраструктуры",
    note: "Приходят всегда и не отключаются",
  },
];

/**
 * Категория → модули, чей `Module.config.notificationRecipients` реально
 * управляет персональным фанаутом (путь 2 в `notifyAdmin`).
 *
 * Каталог хранит секции админки, а не слуги модулей, и соответствие есть не
 * везде: у `payments` moduleSlug события зависит от предмета платежа
 * (бронь/заказ), `avito.lead.new` шлётся `dispatch()` напрямую мимо
 * `notifyAdmin`, у `system.release` группового канала нет вовсе. Для таких
 * категорий подсказка `delivery` считается только по явной подписке —
 * допущение зафиксировано в ADR §3.3 («упрощение допустимо»).
 */
const CATEGORY_MODULE_SLUGS: Record<string, string[]> = {
  bookings: ["gazebos", "ps-park"],
  cafe: ["cafe"],
  rental: ["rental", "nedelovoy"],
};

/**
 * Автопровижининг Telegram-канала при входе в Центр (ADR §5, AC-5.6).
 *
 * Право писать адрес даёт подписанный Telegram initData: подпись HMAC-SHA256
 * покрывает `user.id`, проверяется timing-safe, окно `auth_date` — час.
 * Это строго сильнее OTP-цикла, который здесь заменяется.
 *
 * Читаем все TELEGRAM-каналы пользователя одним запросом: так отличается
 * «канала нет» от «канал есть, но под старым telegramId» (для второго —
 * заводим строку под текущий адрес, старую не трогаем).
 */
export async function ensureTelegramChannel(
  userId: string,
  telegramId: string | null
): Promise<NotificationCenterChannel> {
  // Без telegramId адресовать нечего — Центр работает, но канал не заводим.
  if (!telegramId) {
    return { kind: "TELEGRAM", status: "inactive", provisionedNow: false };
  }

  const channels = await prisma.userNotificationChannel.findMany({
    where: { userId, kind: "TELEGRAM" },
    select: { id: true, address: true, isActive: true, verifiedAt: true },
  });

  const existing = channels.find((c) => c.address === telegramId);

  if (!existing) {
    try {
      await prisma.userNotificationChannel.create({
        data: {
          userId,
          kind: "TELEGRAM",
          address: telegramId,
          label: "Telegram",
          // Ниже дефолтных 100 — Telegram становится основным каналом
          // сотрудника, открывшего Центр из Telegram.
          priority: 10,
          isActive: true,
          verifiedAt: new Date(),
        },
      });
      return { kind: "TELEGRAM", status: "active", provisionedNow: true };
    } catch (err) {
      // Гонка двух параллельных открытий Центра: уникальный ключ
      // (userId, kind, address) уже занят — канал есть, всё в порядке.
      if (isUniqueViolation(err)) {
        return { kind: "TELEGRAM", status: "active", provisionedNow: false };
      }
      throw err;
    }
  }

  // Деактивация — явное решение пользователя/админа: не реактивируем,
  // UI просит включить канал осознанно.
  if (!existing.isActive) {
    return { kind: "TELEGRAM", status: "inactive", provisionedNow: false };
  }

  if (existing.verifiedAt === null) {
    await prisma.userNotificationChannel.update({
      where: { id: existing.id },
      data: { verifiedAt: new Date() },
    });
    return { kind: "TELEGRAM", status: "active", provisionedNow: true };
  }

  // Верифицированный активный канал — идемпотентно ничего не делаем.
  return { kind: "TELEGRAM", status: "active", provisionedNow: false };
}

/**
 * Гость в Центре не бывает: роут отсекает USER ещё в `loadWebAppStaff`.
 * Дублируем проверку в сервисе — второй вызывающий не должен уметь обойти
 * её случайно (и канал гостю никто не провижинит).
 */
function assertStaff(staff: WebAppStaffContext): void {
  if (staff.role === "USER") {
    throw new CenterError(
      "FORBIDDEN",
      "Центр уведомлений доступен только сотрудникам",
      403
    );
  }
}

/** Состояние Центра для сотрудника: категории по правам + канал доставки. */
export async function getNotificationCenter(
  staff: WebAppStaffContext,
  telegramId: string | null
): Promise<NotificationCenterView> {
  assertStaff(staff);

  const [channel, categories, preferences] = await Promise.all([
    ensureTelegramChannel(staff.id, telegramId),
    resolveManagedCategories({ id: staff.id, role: staff.role }, staff.sections),
    getPreferences(staff.id),
  ]);

  // Отсутствие строки = подписки нет (принцип явной подписки, ADR §3.3):
  // дефолт `enabled: true` из mergePreferences к staff-фанауту не применяется.
  const explicit = new Map(
    preferences.events.map((row) => [row.eventType, row.enabled])
  );

  const groupFanoutKeys = await resolveModuleRecipientCategories(
    staff.id,
    categories
  );

  const view = categories.map<NotificationCenterCategory>((category) => {
    const events = category.events.map<NotificationCenterEvent>((event) => {
      const row = explicit.get(event.eventType);
      return {
        eventType: event.eventType,
        label: event.label,
        description: event.description,
        enabled: row ?? false,
        source: row === undefined ? "default" : "explicit",
      };
    });

    const subscribed = events.some(
      (event) => event.source === "explicit" && event.enabled
    );

    return {
      key: category.key,
      label: category.label,
      description: category.description,
      icon: category.icon,
      delivery:
        groupFanoutKeys.has(category.key) || subscribed ? "personal" : "group",
      events,
    };
  });

  return {
    role: staff.role,
    channel,
    categories: view,
    protected: PROTECTED_NOTICES,
  };
}

/** Переключение одного типа уведомления сотрудником. */
export async function setEventPreference(
  staff: WebAppStaffContext,
  eventType: string,
  enabled: boolean
): Promise<{ eventType: string; enabled: boolean }> {
  assertStaff(staff);

  if (!(MANAGED_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new CenterError(
      "VALIDATION_ERROR",
      "Неизвестный тип уведомления",
      422
    );
  }

  const category = categoryForEvent(eventType);
  if (!category) {
    throw new CenterError(
      "VALIDATION_ERROR",
      "Неизвестный тип уведомления",
      422
    );
  }

  // Права перечитываются из БД на каждый запрос (AC-5.8): секции приходят
  // из loadWebAppStaff, а не из токена.
  const accessible = await resolveManagedCategories(
    { id: staff.id, role: staff.role },
    staff.sections
  );
  if (!accessible.some((c) => c.key === category.key)) {
    throw new CenterError(
      "FORBIDDEN",
      "Нет доступа к этой категории уведомлений",
      403
    );
  }

  if (eventType === RELEASE_EVENT_TYPE) {
    // Единственный путь записи подписки на релизы (ADR §6.4): пишет и
    // предпочтение, и легаси-зеркало notifyReleases — дрейфа нет.
    await setReleaseSubscription(staff.id, enabled);
  } else {
    await upsertEventPreference(staff.id, eventType, { enabled });
  }

  return { eventType, enabled };
}

/** Категории, где пользователь уже перечислен в Module.config.notificationRecipients. */
async function resolveModuleRecipientCategories(
  userId: string,
  categories: ManagedCategory[]
): Promise<Set<string>> {
  const slugsByCategory = new Map<string, string[]>();
  for (const category of categories) {
    const slugs = CATEGORY_MODULE_SLUGS[category.key];
    if (slugs && slugs.length > 0) slugsByCategory.set(category.key, slugs);
  }

  const slugs = [...new Set([...slugsByCategory.values()].flat())];
  if (slugs.length === 0) return new Set();

  const modules = await prisma.module.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true, config: true },
  });

  const withMe = new Set(
    modules
      .filter((mod) => {
        const config = mod.config as Record<string, unknown> | null;
        const recipients =
          (config?.notificationRecipients as string[] | undefined) ?? [];
        return recipients.includes(userId);
      })
      .map((mod) => mod.slug)
  );

  const result = new Set<string>();
  for (const [key, categorySlugs] of slugsByCategory) {
    if (categorySlugs.some((slug) => withMe.has(slug))) result.add(key);
  }
  return result;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}
