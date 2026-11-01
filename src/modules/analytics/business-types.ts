export const BUSINESS_MODULES = ["gazebos", "ps-park", "cafe"] as const;
export type BusinessModule = typeof BUSINESS_MODULES[number];
export type BusinessPeriod = "7d" | "30d" | "90d";
export type BusinessMoney = { receipts: number; refunds: number; adjustments: number; net: number; cash: number; card: number; online: number };
export type BusinessLine = BusinessMoney & { slug: BusinessModule; label: string; bookings: number; completed: number; cancelled: number; noShows: number; orders: number; linkedOrders: number; knownCustomers: number; repeatCustomers: number; unidentifiedOperations: number; coverage: string };
export type BusinessReport = {
  period: { from: string; to: string; timezone: "Europe/Moscow"; days: number };
  generatedAt: string;
  totals: BusinessMoney;
  previous: BusinessMoney;
  lines: BusinessLine[];
  daily: (BusinessMoney & { date: string })[];
  funnel: { slug: BusinessModule; views: number; started: number; submitted: number; paid: number }[];
  quality: { excludedLedgerRows: number; duplicateLedgerRows: number; unknownPaymentRows: number; warnings: string[] };
  marketing: { visits: number | null; adSpend: number | null; clicks: number | null; fetchedAt: string; scope: string };
};
export type BusinessPreference = { enabled: boolean; timezone: "Europe/Moscow"; schedule: string; telegramReady: boolean; lastDelivery: { status: string; createdAt: string; sentAt: string | null } | null };
