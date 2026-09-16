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
    /** ID главной цели Метрики, выбранной для тайла «Конверсия сайта». NULL = не выбрана. */
    primaryGoalId: number | null;
    /** Достижения главной цели за период. NULL если цель не выбрана или не найдена в данных. */
    primaryGoalConversions: number | null;
  };
  cachedAt: string;
};

export type CampaignsData = {
  period: DateRange;
  campaigns: CampaignStats[];
  totals: AdvertisingSummary;
  cachedAt: string;
};

// --- ProductEvent / funnel stats (US-1 эпика #583, ADR 2026-09-16) ---

export type FunnelStepStats = {
  step: string;
  label: string;
  /** Сырое число событий (может переучитывать при флапе/дублях верхних шагов). */
  events: number;
  /** Число уникальных sessionKey — основная метрика конверсии (ADR §4). */
  sessions: number;
  /** % от предыдущего шага по sessions. null для первого шага воронки. */
  conversionFromPrev: number | null;
  /** % от первого шага воронки по sessions. */
  conversionFromTop: number;
};

export type FunnelStats = {
  funnel: string;
  steps: FunnelStepStats[];
  /** Шаг с наибольшим оттоком (наименьший conversionFromPrev). null если данных нет. */
  biggestDropStep: string | null;
};

export type FunnelStatsData = {
  period: DateRange;
  funnels: FunnelStats[];
};

// --- Недельный отчёт по воронке (US-2/US-3 эпика #583, ADR
// 2026-09-16-weekly-product-analyst-loop) ---

export const WEEKLY_SIDECAR_SCHEMA_VERSION = 1 as const;

export type WeeklyFunnelSummary = {
  funnel: string;
  /** Человекочитаемое название воронки — из funnels.ts, для отчёта и дайджеста. */
  label: string;
  /** Сессий на первом шаге воронки за отчётный период. */
  topSessions: number;
  /** % последнего шага от первого (сквозная конверсия воронки). */
  endToEndConversion: number;
  /** Изменение сквозной конверсии к прошлой неделе, п.п. null — не считаем (мало данных). */
  endToEndDeltaPp: number | null;
  biggestDropStep: string | null;
  biggestDropLabel: string | null;
  /** conversionFromPrev худшего шага, %. null — нет данных для расчёта. */
  biggestDropConversion: number | null;
  /** По этой воронке выводы не делаем (AC-2.5) — topSessions ниже порога. */
  insufficientData: boolean;
};

export type WeeklyHypothesisRef = {
  issue: number;
  title: string;
  funnel: string;
  step: string;
  /** Строка baseline, как она ушла в тело issue — для отображения в дайджесте/отчёте. */
  baseline: string;
};

export type WeeklyFunnelSidecar = {
  schemaVersion: typeof WEEKLY_SIDECAR_SCHEMA_VERSION;
  /** YYYY-MM-DD — день публикации отчёта (обычно понедельник). */
  reportDate: string;
  /** Путь к markdown-отчёту относительно корня репозитория. */
  reportPath: string;
  /** Отчётный период — закрытая неделя Пн–Вс. */
  period: DateRange;
  previousPeriod: DateRange;
  /** ISO-момент генерации отчёта. */
  publishedAt: string;
  /** По всем 4 воронкам данных недостаточно — выводов и гипотез в отчёте нет (AC-2.5). */
  insufficientData: boolean;
  funnels: WeeklyFunnelSummary[];
  /** Максимум 3 (AC-2.3). */
  hypotheses: WeeklyHypothesisRef[];
};

/** Сжатая версия сайдкара для блока в вечернем дайджесте (AC-3.1/3.2/3.4). */
export type WeeklyFunnelDigest = {
  period: DateRange;
  reportPath: string;
  insufficientData: boolean;
  funnels: {
    label: string;
    endToEndConversion: number;
    endToEndDeltaPp: number | null;
    biggestDropLabel: string | null;
    biggestDropConversion: number | null;
    insufficientData: boolean;
  }[];
  hypotheses: { issue: number; title: string }[];
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
