export const BUSINESS_MODULES = ["gazebos", "ps-park", "cafe"] as const;
export type BusinessModule = typeof BUSINESS_MODULES[number];
export const BUSINESS_PERIODS = ["7d", "30d", "90d", "180d", "365d"] as const;
export type BusinessPeriod = typeof BUSINESS_PERIODS[number];
/** Inclusive Moscow calendar dates, YYYY-MM-DD. */
export type BusinessDateRange = { from: string; to: string };
export type BusinessRangeInput = BusinessPeriod | BusinessDateRange;
export const BUSINESS_GRANULARITIES = ["day", "week", "month"] as const;
export type BusinessGranularity = typeof BUSINESS_GRANULARITIES[number];
/** Longest custom range: two years plus a leap day. */
export const BUSINESS_MAX_RANGE_DAYS = 731;
export type BusinessMoney = { receipts: number; refunds: number; adjustments: number; net: number; cash: number; card: number; online: number };
export type BusinessLine = BusinessMoney & { slug: BusinessModule; label: string; bookings: number; completed: number; cancelled: number; noShows: number; orders: number; linkedOrders: number; knownCustomers: number; repeatCustomers: number; unidentifiedOperations: number; coverage: string };
/** Per-bucket slice of one direction: money by ledger date, operations by service/creation date. */
export type BusinessBucketLine = BusinessMoney & { operations: number; completed: number; cancelled: number };
export type BusinessBucket = BusinessMoney & { from: string; to: string; lines: Record<BusinessModule, BusinessBucketLine> };
export type BusinessReport = {
  period: { from: string; to: string; timezone: "Europe/Moscow"; days: number };
  generatedAt: string;
  totals: BusinessMoney;
  previous: BusinessMoney;
  lines: BusinessLine[];
  series: { granularity: BusinessGranularity; rows: BusinessBucket[] };
  funnel: { slug: BusinessModule; views: number; started: number; submitted: number; paid: number }[];
  quality: { excludedLedgerRows: number; duplicateLedgerRows: number; unknownPaymentRows: number; warnings: string[] };
  marketing: { visits: number | null; adSpend: number | null; clicks: number | null; fetchedAt: string; scope: string };
};
export type BusinessPreference = { enabled: boolean; timezone: "Europe/Moscow"; schedule: string; telegramReady: boolean; lastDelivery: { status: string; createdAt: string; sentAt: string | null } | null };
