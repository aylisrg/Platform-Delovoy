import type { Role } from "@prisma/client";
import type { AdminSection } from "@/lib/permissions";
import type { WebAppIconName } from "@/lib/webapp/icon-names";

/**
 * Курируемый каталог типов уведомлений, управляемых из Центра уведомлений
 * Mini App (ADR 2026-08-13-miniapp-role-rebuild §4).
 *
 * Leaf-модуль без импортов БД и роутов — импортируется клиентом и тестами.
 *
 * Правила:
 * - В каталоге только реально существующие в EVENT_ROUTING типы — тумблер,
 *   за которым нет события, запрещён (тест держит инвариант).
 * - Инфраструктурные CRITICAL-алерты (watchdog, health, curl из CI) сюда
 *   не входят и не могут войти: они физически не проходят через dispatch()
 *   и NotificationEventPreference (AC-5.7, первый слой защиты).
 * - PUT Центра валидирует eventType закрытым enum из MANAGED_EVENT_TYPES
 *   (второй слой защиты).
 */

export type ManagedEvent = {
  eventType: string;
  label: string;
  description: string;
  /**
   * On until the person explicitly turns it off (path `default` in
   * `audience-rules.ts`): `true` — every staff member with access to the
   * category, `"admins"` — ADMIN and SUPERADMIN with access (MANAGER opts in),
   * `"superadmin"` — only current SUPERADMINs (others opt in).
   * Каталог без флага не бывает: у ADMIN/SUPERADMIN включено всё (владелец,
   * 2026-11-09), тест держит инвариант.
   * Без строки предпочтения тумблер в Центре стоит «Вкл» с подписью «по
   * умолчанию»; явное «Выкл» сильнее (ADR 2026-11-09-staff-booking-reports-digest).
   */
  defaultEnabled?: boolean | "admins" | "superadmin";
  /** Overrides the category delivery for this event (mixed categories). */
  delivery?: "in-app" | "personal";
};

export type ManagedCategory = {
  /** Ключ категории Центра уведомлений */
  key: string;
  label: string;
  description: string;
  icon: WebAppIconName;
  /** Доступ: хотя бы одна из секций админ-панели (ADMIN_SECTIONS) */
  sections: AdminSection[];
  /** true → категория дополнительно доступна роли SUPERADMIN без секций */
  superadminAlways?: boolean;
  /** Unlike grandfathered external subscriptions, this requires the current role. */
  superadminOnly?: boolean;
  /** Any current staff member has access (releases are not tied to a section). */
  staffAlways?: boolean;
  /** Only these roles may receive the category (on top of the section rule). */
  roles?: Role[];
  delivery?: "in-app";
  events: ManagedEvent[];
};

export const NOTIFICATION_CATALOG: ManagedCategory[] = [
  {
    key: "telephony",
    label: "Звонки",
    description: "Итоги дня: в ленте Mini App и сообщением бота",
    icon: "bell",
    sections: ["telephony"],
    superadminAlways: true,
    superadminOnly: true,
    delivery: "in-app",
    events: [
      {
        // На по умолчанию у суперадмина — ролевой путь `in_app_superadmin`
        // (audience-rules.ts), а не общий `default`: так было с запуска.
        eventType: "telephony.daily_summary",
        label: "Ежедневная сводка звонков",
        description: "После 09:00 МСК за предыдущий день: всего, принято и пропущено. Карточка в ленте Mini App.",
      },
      {
        // Владелец не видел сводку, пока не открывал ленту (2026-11-09):
        // те же три числа, без номеров и имён, личным сообщением бота.
        eventType: "telephony.daily_summary_telegram",
        label: "Сводка звонков в Telegram",
        description: "Та же сводка сообщением бота в 09:00 МСК — без номеров и имён",
        defaultEnabled: "superadmin",
        delivery: "personal",
      },
    ],
  },
  {
    key: "reports",
    label: "Отчётность",
    description: "Бизнес-итоги недели по финансовой книге",
    icon: "receipt",
    sections: ["analytics"],
    superadminAlways: true,
    // Тот же круг, что getBusinessViewer: MANAGER финансовые итоги не получает.
    roles: ["SUPERADMIN", "ADMIN"],
    events: [
      {
        eventType: "analytics.business_weekly",
        label: "Бизнес-отчёт за неделю",
        description: "По понедельникам после 09:00 МСК: поступления, возвраты и нетто по паркам",
        defaultEnabled: "admins",
      },
    ],
  },
  {
    key: "bookings",
    label: "Бронирования",
    description: "Барбекю Парк и Плей Парк",
    icon: "calendar",
    // Одна категория на оба парка: ключ предпочтения — (userId, eventType),
    // booking.created физически один тип для обоих модулей. Два раздельных
    // тумблера, за которыми одна строка БД, обманывали бы пользователя
    // (ADR §4, осознанное отступление от буквы AC-5.1).
    sections: ["gazebos", "ps-park"],
    // Все события брони идут лично каждому, у кого есть раздел, — по
    // умолчанию «Вкл», каждый выключает лишнее сам (владелец, 2026-11-09).
    // Групповой чат раздела работает как раньше и от этих тумблеров не зависит.
    events: [
      {
        eventType: "booking.created",
        label: "Новая бронь",
        description: "Гость создал бронь беседки или стола (онлайн-бронь — после оплаты)",
        defaultEnabled: true,
      },
      {
        eventType: "booking.admin_created",
        label: "Бронь по телефону",
        description: "Коллега принял бронь в панели — она уже подтверждена",
        defaultEnabled: true,
      },
      {
        eventType: "booking.rescheduled",
        label: "Перенос брони",
        description: "Изменились дата, время или беседка",
        defaultEnabled: true,
      },
      {
        eventType: "booking.cancelled",
        label: "Отмена брони",
        description: "Бронь отменена гостем или администратором",
        defaultEnabled: true,
      },
      {
        eventType: "booking.ending_soon",
        label: "Бронь скоро закончится",
        description: "За час до конца брони беседки — предложить продление",
        defaultEnabled: "admins",
      },
    ],
  },
  {
    key: "cafe",
    label: "Кафе",
    description: "Заказы и их отмены",
    icon: "coffee",
    sections: ["cafe"],
    events: [
      {
        eventType: "order.placed",
        label: "Новый заказ",
        description: "Гость оформил заказ в кафе",
        defaultEnabled: "admins",
      },
      {
        eventType: "order.cancelled",
        label: "Отмена заказа",
        description: "Заказ отменён",
        defaultEnabled: "admins",
      },
    ],
  },
  {
    key: "rental",
    label: "Аренда",
    description: "Договоры и заявки на офисы",
    icon: "building",
    sections: ["rental"],
    events: [
      {
        eventType: "contract.created",
        label: "Новый договор",
        description: "Заключён договор аренды",
        defaultEnabled: "admins",
      },
      {
        eventType: "contract.expiring",
        label: "Договор истекает",
        description: "До окончания договора меньше 30 дней",
        defaultEnabled: "admins",
      },
      {
        eventType: "inquiry.created",
        label: "Новая заявка",
        description: "Поступила заявка на аренду офиса",
        defaultEnabled: "admins",
      },
    ],
  },
  {
    key: "payments",
    label: "Платежи",
    description: "Онлайн-оплаты и возвраты",
    icon: "card",
    sections: ["analytics", "monitoring"],
    events: [
      {
        eventType: "payment.succeeded",
        label: "Успешная оплата",
        description: "Онлайн-платёж прошёл успешно",
        defaultEnabled: "admins",
      },
      {
        eventType: "payment.refund.succeeded",
        label: "Возврат",
        description: "Возврат по платежу выполнен",
        defaultEnabled: "admins",
      },
    ],
  },
  {
    key: "avito",
    label: "Авито",
    description: "Лиды с объявлений Авито",
    icon: "megaphone",
    // В ADR категория называлась «Обратная связь» с секцией feedback, но
    // событий feedback.* нет в EVENT_ROUTING. Честный вариант: категория «Авито» под секцией avito
    // с единственным реально существующим событием.
    sections: ["avito"],
    events: [
      {
        eventType: "avito.lead.new",
        label: "Новый лид",
        description: "Сообщение или звонок с объявления Авито",
        defaultEnabled: "admins",
      },
    ],
  },
  {
    key: "system",
    label: "Системные",
    description: "Релизы платформы",
    icon: "shield",
    sections: ["monitoring"],
    superadminAlways: true,
    staffAlways: true,
    events: [
      {
        eventType: "system.release",
        label: "Релизы платформы",
        description: "Одно сообщение на каждый продакшн-релиз",
        defaultEnabled: "admins",
      },
    ],
  },
];

export const MANAGED_EVENT_TYPES = NOTIFICATION_CATALOG.flatMap((category) =>
  category.events.map((event) => event.eventType)
) as [string, ...string[]];

/**
 * Real `moduleSlug`s each catalog event is emitted with (the context the
 * recipient resolver evaluates; ADR 2026-10-25-team-access-notifications §Q7).
 * `null` = no module (role-based / system events). A test keeps every catalog
 * type covered.
 *
 * Invariant (§Q8): catalog types are staff-only — client notifications go
 * through the legacy `notifyClient` path and never read
 * NotificationEventPreference, so a staff preference row can't mute a
 * person's own booking/order messages. If a client path ever moves to
 * `dispatch()`, it must use its own namespace (e.g. `client.booking.created`).
 */
export const EVENT_MODULE_CONTEXTS: Record<string, Array<string | null>> = {
  "telephony.daily_summary": [null],
  "telephony.daily_summary_telegram": [null],
  "analytics.business_weekly": [null],
  "booking.created": ["gazebos", "ps-park"],
  "booking.admin_created": ["gazebos", "ps-park"],
  "booking.rescheduled": ["gazebos"],
  "booking.cancelled": ["gazebos", "ps-park"],
  "booking.ending_soon": ["gazebos"],
  "order.placed": ["cafe"],
  "order.cancelled": ["cafe"],
  "contract.created": ["rental"],
  "contract.expiring": ["rental"],
  "inquiry.created": ["rental-inquiry"],
  "payment.succeeded": ["gazebos", "ps-park", "cafe"],
  "payment.refund.succeeded": ["gazebos", "ps-park", "cafe"],
  "avito.lead.new": ["gazebos", "ps-park", null],
  "system.release": [null],
};

/** Event moduleSlug → module whose assignment grants access (no Module row for aliases). */
export const MODULE_ACCESS_ALIAS: Record<string, string> = {
  "rental-inquiry": "rental",
};

export function managedEvent(eventType: string): ManagedEvent | undefined {
  for (const category of NOTIFICATION_CATALOG) {
    const event = category.events.find((e) => e.eventType === eventType);
    if (event) return event;
  }
  return undefined;
}

/** Event is on for this role while no explicit preference row exists. */
export function isDefaultOnFor(eventType: string, role: Role): boolean {
  return defaultOnRoles(eventType).includes(role);
}

/** Roles that may get the event by default (candidate pre-filter for the resolver). */
export function defaultOnRoles(eventType: string): Role[] {
  const flag = managedEvent(eventType)?.defaultEnabled;
  if (flag === true) return ["SUPERADMIN", "ADMIN", "MANAGER"];
  if (flag === "admins") return ["SUPERADMIN", "ADMIN"];
  if (flag === "superadmin") return ["SUPERADMIN"];
  return [];
}

export function categoryForEvent(
  eventType: string
): ManagedCategory | undefined {
  return NOTIFICATION_CATALOG.find((category) =>
    category.events.some((event) => event.eventType === eventType)
  );
}
