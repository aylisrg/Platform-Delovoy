/**
 * Notification routing categories — single source of truth.
 *
 * Each category `key` is a `Module.slug`; its Telegram chat lives in that
 * module's `config.telegramAdminChatId`, falling back to the global admin chat.
 * Shared by the routing config route and the monitoring channel-test surfaces so
 * labels/icons never drift (previously duplicated, which dropped `rental-inquiry`).
 *
 * Leaf data module: no DB / server-only imports, and it must not import from any
 * route file (keeps it import-safe everywhere and avoids circular imports).
 */
export const ROUTING_CATEGORIES = [
  {
    key: "gazebos",
    label: "Барбекю Парк",
    description: "Бронирования беседок и мангальных зон",
    icon: "🏕",
  },
  {
    key: "ps-park",
    label: "Плей Парк",
    description: "Бронирования PlayStation-столов",
    icon: "🎮",
  },
  {
    key: "cafe",
    label: "Кафе",
    description: "Заказы еды и напитков",
    icon: "☕",
  },
  {
    key: "rental",
    label: "Аренда",
    description: "Заявки на аренду, договоры",
    icon: "🏢",
  },
  {
    key: "rental-inquiry",
    label: "Заявки на офис (лендинг)",
    description: "Новые заявки с формы аренды офиса — отдельный канал",
    icon: "📨",
  },
  {
    key: "inventory",
    label: "Склад",
    description: "Приёмки, списания, низкие остатки",
    icon: "📋",
  },
  {
    key: "feedback",
    label: "Обратная связь",
    description: "Обращения от пользователей (баги, предложения)",
    icon: "💬",
  },
  {
    key: "system",
    label: "Системные алерты",
    description: "Health check, ошибки, критичные события",
    icon: "🔍",
  },
] as const;

export type RoutingCategory = (typeof ROUTING_CATEGORIES)[number];
export type RoutingCategoryKey = RoutingCategory["key"];

/** All category keys — used to build closed Zod enums and DB `in` filters. */
export const ROUTING_CATEGORY_KEYS = ROUTING_CATEGORIES.map(
  (c) => c.key
) as [RoutingCategoryKey, ...RoutingCategoryKey[]];

/** Human-readable label for a category key, or the key itself if unknown. */
export function labelForCategory(key: string): string {
  return ROUTING_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}
