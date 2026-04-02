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
};
