/**
 * Event routing configuration.
 * Maps event types to whether they trigger client and/or admin notifications.
 */

type EventRoute = {
  client: boolean;
  admin: boolean;
  /** Which preference category controls this event for client opt-out */
  category?: "booking" | "order" | "reminder";
};

export const EVENT_ROUTING: Record<string, EventRoute> = {
  // Bookings (gazebos, ps-park)
  "booking.created": { client: true, admin: true, category: "booking" },
  "booking.confirmed": { client: true, admin: false, category: "booking" },
  "booking.cancelled": { client: true, admin: true, category: "booking" },
  "booking.reminder": { client: true, admin: false, category: "reminder" },
  // За 1 час до ОКОНЧАНИЯ брони — предложение продлить. Клиенту (если есть
  // канал) + выделенный Telegram-канал беседок обслуживается отдельно
  // (dispatchModuleChannel), где у админа есть ссылка на продление.
  "booking.ending_soon": { client: true, admin: false, category: "reminder" },
  // Канал-only событие «бронь оплачена»: ни client, ни admin через notify()
  // (оба false — notify находит роутинг, ничего не шлёт и не варнит), а
  // выделенный Telegram-канал обслуживается dispatchModuleChannel отдельно.
  "booking.paid": { client: false, admin: false },
  // Канал-only: задачи на уборку после брони (обслуживается dispatchModuleChannel).
  "booking.cleaning": { client: false, admin: false },

  // Cafe orders
  "order.placed": { client: true, admin: true, category: "order" },
  "order.preparing": { client: true, admin: false, category: "order" },
  "order.ready": { client: true, admin: false, category: "order" },
  "order.delivered": { client: true, admin: false, category: "order" },
  "order.cancelled": { client: true, admin: true, category: "order" },
  // Канал-only «заказ оплачен» (зеркало booking.paid): админ-группа получает
  // общий payment.succeeded, а выделенный Telegram-канал кафе — подробный
  // состав заказа через dispatchModuleChannel.
  "order.paid": { client: false, admin: false },

  // Rental contracts (admin-only)
  "contract.created": { client: false, admin: true },
  "contract.expiring": { client: false, admin: true },

  // Rental inquiries (admin-only)
  "inquiry.created": { client: false, admin: true },

  // Avito integration — lead came in via Messenger (PR-2).
  "avito.lead.new": { client: false, admin: true },

  // Online payments (YooKassa) — see docs/requirements/2026-07-09-payments-module-prd.md
  "payment.succeeded": { client: true, admin: true },
  "payment.canceled": { client: true, admin: false },
  "payment.refund.succeeded": { client: true, admin: true },
};
