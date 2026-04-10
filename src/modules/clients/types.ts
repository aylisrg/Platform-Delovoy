export type ModuleUsage = {
  moduleSlug: string;
  moduleName: string;
  firstUsedAt: string;
  count: number;
  totalSpent: number;
};

export type ClientSummary = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  image: string | null;
  telegramId: string | null;
  vkId: string | null;
  createdAt: string;
  modulesUsed: ModuleUsage[];
  totalSpent: number;
  bookingCount: number;
  orderCount: number;
  lastActivityAt: string | null;
};

export type ClientBooking = {
  id: string;
  moduleSlug: string;
  resourceName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  amount: number;
  createdAt: string;
};

export type ClientOrder = {
  id: string;
  moduleSlug: string;
  status: string;
  totalAmount: number;
  itemCount: number;
  deliveryTo: string | null;
  createdAt: string;
};

export type ActivityEvent = {
  id: string;
  type: "booking" | "order";
  moduleSlug: string;
  action: string;
  description: string;
  amount: number | null;
  createdAt: string;
};

export type MonthlySpending = {
  month: string;
  bookingsSpent: number;
  ordersSpent: number;
  total: number;
};

export type ClientDetail = ClientSummary & {
  bookings: ClientBooking[];
  orders: ClientOrder[];
  activityTimeline: ActivityEvent[];
  spendingByMonth: MonthlySpending[];
};

export type ClientFilter = {
  search?: string;
  moduleSlug?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: "totalSpent" | "lastActivity" | "createdAt" | "name";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
};

export type ClientStats = {
  totalClients: number;
  newThisMonth: number;
  newThisWeek: number;
  activeThisMonth: number;
  topSpenders: Array<{ id: string; name: string | null; totalSpent: number }>;
  moduleBreakdown: Array<{
    moduleSlug: string;
    moduleName: string;
    clientCount: number;
  }>;
};
