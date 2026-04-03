export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "offline";

export type ModuleMapEntry = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isActive: boolean;
  healthStatus: HealthStatus;
  metrics: Record<string, unknown>;
  lastChecked: string;
};

export type BookingStats = {
  todayTotal: number;
  weekTotal: number;
  byModule: Record<string, number>;
};

export type OrderStats = {
  todayCount: number;
  todayRevenue: number;
  weekRevenue: number;
};

export type RentalStats = {
  activeContracts: number;
  monthlyRevenue: number;
  occupancyRate: number;
  expiringIn30Days: number;
};

export type AggregateAnalytics = {
  bookings: BookingStats;
  orders: OrderStats;
  rental: RentalStats;
  systemEvents: {
    last24h: number;
    lastHour: number;
    criticalCount: number;
  };
  generatedAt: string;
};

export type AuditLogEntry = {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
};

export type AuditFilter = {
  userId?: string;
  entity?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

export type AnalyticsFilter = {
  dateFrom?: string;
  dateTo?: string;
};

export type ModuleConfigPatch = {
  isActive?: boolean;
  config?: Record<string, unknown>;
};
