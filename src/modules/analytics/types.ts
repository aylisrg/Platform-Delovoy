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
  costPerConversion: number | null;
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
};

export type AdvertisingSummary = {
  impressions: number;
  clicks: number;
  ctr: number;
  cost: number;
  avgCpc: number;
};

// --- Aggregates ---

export type ConversionCost = {
  goalName: string;
  reaches: number;
  totalCost: number;
  costPerReach: number | null;
};

export type OverviewData = {
  period: DateRange;
  traffic: TrafficSummary;
  advertising: AdvertisingSummary;
  conversions: GoalConversion[];
  summary: {
    totalConversions: number;
    totalCost: number;
    avgCostPerConversion: number | null;
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
  costPerConversion: ConversionCost[];
  cachedAt: string;
};
