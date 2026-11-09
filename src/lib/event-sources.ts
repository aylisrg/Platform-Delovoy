/**
 * Реестр `SystemEvent.source` (issue #581). Раньше `source` был свободной
 * строкой — имена дрейфовали (`scheduler` vs `rental.scheduler`,
 * `cron/inventory` vs `cron.notifications`, точки vs слэши), что размывало
 * группировку по source на дашборде мониторинга.
 *
 * Конвенция — `домен.поддомен` через точку. Значения ниже НЕ мигрируют старые
 * строки в БД (schema не трогаем) — только пишущий код закрепляет одно
 * каноничное имя на будущее. Два значения ниже переименованы (закрывают
 * конкретные примеры дрейфа из аудита): `scheduler` → `booking.scheduler`,
 * `cron/inventory` → `cron.inventory`, `cron/process-recurring` →
 * `cron.processRecurring` — старые строки в уже существующих строках БД
 * останутся как есть, это ожидаемо при отказе от миграции данных.
 *
 * Значения, помеченные "НЕ переименовывать", читаются по точному значению
 * в другом месте кода — смена строки тихо сломала бы то место:
 *   - `client-beacon` — SQL в `site-watchdog.yml` (beacon-divergence) и
 *     `deploy-error-budget.yml`
 *   - `cron.processOutgoing` — `src/modules/notifications/health.ts` (heartbeat)
 */
export const EVENT_SOURCES = {
  // avito (интеграция, src/lib/avito/ + src/app/api/avito/)
  AVITO_CALLS: "avito.calls",
  AVITO_CRON_POLL: "avito.cron.poll",
  AVITO_REPLY: "avito.reply",
  AVITO_WEBHOOK: "avito.webhook",
  AVITO_WEBHOOK_CALLS: "avito.webhook.calls",

  // booking (shared booking core)
  BOOKING_SCHEDULER: "booking.scheduler", // было "scheduler" — дрейф из F4

  // rental
  RENTAL_SCHEDULER: "rental.scheduler",

  // cron-эндпоинты
  CRON_INVENTORY: "cron.inventory", // было "cron/inventory" — дрейф разделителя
  CRON_PROCESS_RECURRING: "cron.processRecurring", // было "cron/process-recurring"
  CRON_PROCESS_OUTGOING: "cron.processOutgoing", // НЕ переименовывать — notifications/health.ts
  CRON_NOTIFICATIONS: "cron.notifications",

  // monitoring
  CLIENT_BEACON: "client-beacon", // НЕ переименовывать — по нему фильтруют site-watchdog и deploy-error-budget
  MONITORING_ROUTING_MAP: "monitoring.routing-map",

  // admin
  ADMIN_TELEGRAM: "admin.telegram",

  // Telegram-бот (bot/, отдельный процесс)
  BOT: "bot",

  // deletion (src/lib/deletion.ts)
  DELETION_GUARD: "deletion.guard",
  DELETION_LOG: "deletion.log",

  // inventory
  INVENTORY_RECEIPT_DELETE: "inventory.receipt.delete",

  // остальные модули/роуты — плоские имена, уже без дрейфа (сохраняем как есть)
  AUTH: "auth",
  BOOKING: "booking",
  PAYMENTS: "payments",
  NOTIFICATIONS: "notifications",
  RELEASE_NOTIFY: "release-notify",
  WAITLIST: "waitlist",
  TASKS: "tasks",
  FEEDBACK: "feedback",
  ARCHITECT: "architect",
  TELEPHONY: "telephony",
  HEALTH: "health",
  GAZEBOS: "gazebos",
  CAFE: "cafe",
  METRIKA: "metrika",
  ANALYTICS_PRODUCT_EVENT: "analytics.product-event",
  RATE_LIMIT: "rate-limit",
  REVIEWS_API: "reviews-api",
  REVIEWS_PARSER: "reviews-parser", // landing-delovoy-park.ru — тот же @/lib/logger
  PROCESS: "process",
  SERVER_ERROR: "server-error",
} as const;

export type EventSource = (typeof EVENT_SOURCES)[keyof typeof EVENT_SOURCES];
