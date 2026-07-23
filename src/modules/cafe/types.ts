import type { Order, OrderItem, MenuItem, OrderStatus } from "@prisma/client";

export type CafeMenuItem = Pick<
  MenuItem,
  "id" | "category" | "name" | "description" | "price" | "imageUrl" | "isAvailable" | "sortOrder"
>;

export type CreateMenuItemInput = {
  category: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  sortOrder?: number;
};

export type UpdateMenuItemInput = Partial<CreateMenuItemInput> & {
  isAvailable?: boolean;
};

export type OrderItemInput = {
  menuItemId: string;
  quantity: number;
};

export type CreateOrderInput = {
  items: OrderItemInput[];
  deliveryTo?: string; // номер офиса
  comment?: string;
  bookingId?: string; // optional link to Booking (PS Park session, gazebo) — F5 ADR
};

/** Публичный QR-чекаут: заказ + онлайн-оплата. Контакт — для чека 54-ФЗ. */
export type CheckoutInput = Omit<CreateOrderInput, "bookingId"> & {
  customerEmail?: string;
  customerPhone?: string;
};

export type CheckoutResult = Order & {
  items: OrderItem[];
  /** null — ЮKassa не настроена или недоступна (оплата на кассе). */
  payment: { id: string; confirmationUrl: string | null } | null;
};

export type CafeStatsQuery = {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string; // YYYY-MM-DD
};

export type CafeStats = {
  ordersCount: number;
  revenue: number;
  avgCheck: number;
  /** Заказы, оплаченные онлайн (paidAt != null). */
  onlineCount: number;
  onlineRevenue: number;
  byDay: Array<{ date: string; orders: number; revenue: number }>;
  topItems: Array<{
    menuItemId: string;
    name: string;
    category: string;
    quantity: number;
    revenue: number;
  }>;
  byCategory: Array<{ category: string; quantity: number; revenue: number }>;
  byPaymentMethod: Array<{ method: string; count: number }>;
};

export type CafeOrder = Pick<
  Order,
  "id" | "userId" | "status" | "totalAmount" | "deliveryTo" | "createdAt"
> & {
  items: Array<Pick<OrderItem, "id" | "menuItemId" | "quantity" | "price"> & {
    menuItem?: CafeMenuItem;
  }>;
};

export type OrderFilter = {
  status?: OrderStatus;
  userId?: string;
  dateFrom?: string;
  dateTo?: string;
  /** true — только оплаченные онлайн; false — только без онлайн-оплаты. */
  paid?: boolean;
};
