export type DateRange = {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;   // YYYY-MM-DD
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
  reaches: number;
  conversionRate: number;
  shareOfConversions: number; // % from total reaches across all goals
  attributedCost: number | null; // proportional ad-spend share (totalCost * share)
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
  costShare: number; // % of total ad spend across all campaigns in period
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
  trafficSources: TrafficSource[];
  advertising: AdvertisingSummary;
  balance: AccountBalance;
  conversions: GoalConversion[];
  campaigns: CampaignStats[];
  summary: {
    totalConversions: number;
    totalCost: number;
    avgCostPerConversion: number | null;
    activeCampaigns: number;
    bestCampaignByCtr: { name: string; ctr: number } | null;
    worstCampaignByCtr: { name: string; ctr: number } | null;
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
    totalVisits: number;
    totalGoalReaches: number;
    overallConversionRate: number;
  };
  cachedAt: string;
};
