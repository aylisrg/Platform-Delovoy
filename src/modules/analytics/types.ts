export type DateRange = {
  dateFrom: string; // YYYY-MM-DD (Moscow TZ)
  dateTo: string;   // YYYY-MM-DD (Moscow TZ)
};

// --- Metrika ---

export type TrafficSummary = {
  visits: number;
  pageviews: number;
  users: number;
  bounceRate: number;
  avgVisitDuration: number;
};

export type GoalConversion = {
  goalId: number;
  goalName: string;
  goalType: string;
  /** Достижения цели за период со ВСЕХ источников (как в кабинете Метрики). */
  reaches: number;
  /** Достижения той же цели только от трафика из Яндекс.Директа. */
  reachesFromAds: number;
  /** Конверсия (%) от визитов всех источников. */
  conversionRate: number;
  /** Доля цели в общем количестве достижений (всех целей). */
  shareOfConversions: number;
  /**
   * Распределённый рекламный расход на цель пропорционально её доле в
   * рекламных конверсиях. NULL если у нас нет рекламных конверсий вообще.
   */
  attributedCost: number | null;
  /** Стоимость рекламной конверсии для этой цели (cost/reachesFromAds). */
  costPerAdConversion: number | null;
};

export type TrafficSource = {
  source: string;
  visits: number;
  percentage: number;
};

// --- Direct ---

export type CampaignStats = {
  campaignId: number;
  campaignName: string;
  status: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  avgCpc: number;
  costShare: number;
};

export type AdvertisingSummary = {
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  avgCpc: number;
};

export type AccountBalance = {
  amount: number | null;
  currency: string;
  source: "agency_api" | "manual_env" | "unavailable";
  message: string | null;
};

// --- Aggregates ---

export type OverviewData = {
  period: DateRange;
  traffic: TrafficSummary;
  /** Визиты только из Яндекс.Директа (для сверки клики ↔ визиты). */
  adSourceVisits: number;
  trafficSources: TrafficSource[];
  advertising: AdvertisingSummary;
  balance: AccountBalance;
  conversions: GoalConversion[];
  campaigns: CampaignStats[];
  summary: {
    /** Сумма достижений всех целей со всех источников (Метрика-вид). */
    totalConversions: number;
    /** Достижения целей только из трафика Директа (Direct-вид). */
    adSourceConversions: number;
    totalCost: number;
    /**
     * Стоимость одной рекламной конверсии: cost / adSourceConversions.
     * NULL если рекламных конверсий нет.
     */
    costPerAdConversion: number | null;
    activeCampaigns: number;
    bestCampaignByCtr: { name: string; ctr: number } | null;
    worstCampaignByCtr: { name: string; ctr: number } | null;
    /** Включён ли НДС в "cost" (по умолчанию YES в нашем отчёте). */
    costIncludesVat: boolean;
  };
  cachedAt: string;
};

export type CampaignsData = {
  period: DateRange;
  campaigns: CampaignStats[];
  totals: AdvertisingSummary;
  cachedAt: string;
};

export type ConversionsData = {
  period: DateRange;
  goals: GoalConversion[];
  funnel: {
    /** Клики из Директа (= showings * CTR). */
    adClicks: number;
    /** Визиты на сайт из Директа (часть кликов, что доехала). */
    adVisits: number;
    /** Достижения целей из Директа. */
    adConversions: number;
    /** Сквозная конверсия = adConversions / adVisits * 100 (%). */
    adConversionRate: number;
    /** Все визиты (для контекста — обычно > adVisits). */
    totalVisits: number;
    /** Все достижения целей (для контекста — обычно > adConversions). */
    totalGoalReaches: number;
  };
  cachedAt: string;
};
