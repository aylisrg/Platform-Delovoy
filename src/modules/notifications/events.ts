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

  // Cafe orders
  "order.placed": { client: true, admin: true, category: "order" },
  "order.preparing": { client: true, admin: false, category: "order" },
  "order.ready": { client: true, admin: false, category: "order" },
  "order.delivered": { client: true, admin: false, category: "order" },
  "order.cancelled": { client: true, admin: true, category: "order" },

  // Rental contracts (admin-only)
  "contract.created": { client: false, admin: true },
  "contract.expiring": { client: false, admin: true },

  // Rental inquiries (admin-only)
  "inquiry.created": { client: false, admin: true },

  // Avito integration — lead came in via Messenger (PR-2).
  "avito.lead.new": { client: false, admin: true },
};
