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
  /** In-app summaries requested by the owner are on until explicitly disabled. */
  defaultEnabled?: boolean;
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
  delivery?: "in-app";
  events: ManagedEvent[];
};

export const NOTIFICATION_CATALOG: ManagedCategory[] = [
  {
    key: "telephony",
    label: "Звонки",
    description: "Итоги дня в ленте Mini App",
    icon: "bell",
    sections: ["telephony"],
    superadminAlways: true,
    superadminOnly: true,
    delivery: "in-app",
    events: [{
      eventType: "telephony.daily_summary",
      label: "Ежедневная сводка звонков",
      description: "После 09:00 МСК за предыдущий день: всего, принято и пропущено. Только в ленте Mini App.",
      defaultEnabled: true,
    }],
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
    events: [
      {
        eventType: "booking.created",
        label: "Новая бронь",
        description: "Гость создал бронь беседки или стола",
      },
      {
        eventType: "booking.cancelled",
        label: "Отмена брони",
        description: "Бронь отменена гостем или администратором",
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
      },
      {
        eventType: "order.cancelled",
        label: "Отмена заказа",
        description: "Заказ отменён",
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
      },
      {
        eventType: "contract.expiring",
        label: "Договор истекает",
        description: "До окончания договора меньше 30 дней",
      },
      {
        eventType: "inquiry.created",
        label: "Новая заявка",
        description: "Поступила заявка на аренду офиса",
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
      },
      {
        eventType: "payment.refund.succeeded",
        label: "Возврат",
        description: "Возврат по платежу выполнен",
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
  "booking.created": ["gazebos", "ps-park"],
  "booking.cancelled": ["gazebos", "ps-park"],
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

export function categoryForEvent(
  eventType: string
): ManagedCategory | undefined {
  return NOTIFICATION_CATALOG.find((category) =>
    category.events.some((event) => event.eventType === eventType)
  );
}
