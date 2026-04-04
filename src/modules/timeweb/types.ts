// ─── Timeweb Cloud API Types ─────────────────────────────────────────────────

export type TimewebPowerAction = "start" | "shutdown" | "reboot" | "hard-reboot";

/** Subset of Timeweb server object relevant for our dashboard. */
export interface TimewebServerInfo {
  id: number;
  name: string;
  status: string; // "on", "off", "installing", etc.
  os: {
    id: number;
    name: string;
    version: string;
  };
  ip: string | null;
  configuration: {
    cpu: number;
    ram: number; // MB
    disk: number; // MB
  };
  location: string;
  createdAt: string;
}

export interface TimewebStatsDataPoint {
  timestamp: string;
  cpuPercent: number;
  ramPercent: number;
  diskPercent: number;
  networkInBytes: number;
  networkOutBytes: number;
}

export interface TimewebServerStats {
  serverId: number;
  period: string;
  data: TimewebStatsDataPoint[];
}

export interface TimewebLogEntry {
  timestamp: string;
  message: string;
}

export interface TimewebServerLogs {
  serverId: number;
  logs: TimewebLogEntry[];
}

// ─── Query params ────────────────────────────────────────────────────────────

export interface StatsQuery {
  dateFrom?: string;
  dateTo?: string;
}

export interface LogsQuery {
  limit?: number;
  order?: "asc" | "desc";
}
