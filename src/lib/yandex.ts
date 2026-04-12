/**
 * Yandex API client
 *
 * Covers:
 * - Яндекс Директ API (рекламные кампании: показы, клики, расходы)
 * - Яндекс Метрика API (трафик сайта + события из Яндекс Бизнеса: звонки, маршруты)
 *
 * Auth: OAuth 2.0 (single token for all Yandex APIs)
 * Docs:
 *   https://yandex.ru/dev/direct/doc/reports/reports.html
 *   https://yandex.ru/dev/metrika/doc/api2/api_v1/data.html
 */

const DIRECT_API_URL = "https://api.direct.yandex.com/json/v5/reports";
const METRIKA_API_URL = "https://api-metrika.yandex.net/stat/v1/data";

export type YandexDirectStats = {
  impressions: number;
  clicks: number;
  cost: number; // kopecks → we convert to rubles
  ctr: number; // percentage
  configured: boolean;
};

export type YandexMetrikaStats = {
  visits: number;
  callsFromBusiness: number; // make-call events
  routesFromBusiness: number; // make-route events
  configured: boolean;
};

export type YandexMarketingStats = {
  direct: YandexDirectStats;
  metrika: YandexMetrikaStats;
  dateFrom: string;
  dateTo: string;
};

function isDirectConfigured(): boolean {
  return !!(process.env.YANDEX_OAUTH_TOKEN && process.env.YANDEX_DIRECT_CLIENT_LOGIN);
}

function isMetrikaConfigured(): boolean {
  return !!(process.env.YANDEX_OAUTH_TOKEN && process.env.YANDEX_METRIKA_COUNTER_ID);
}

export async function getYandexDirectStats(
  dateFrom: string,
  dateTo: string
): Promise<YandexDirectStats> {
  const empty: YandexDirectStats = { impressions: 0, clicks: 0, cost: 0, ctr: 0, configured: false };

  if (!isDirectConfigured()) return empty;

  const token = process.env.YANDEX_OAUTH_TOKEN!;
  const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN!;

  try {
    const body = {
      params: {
        SelectionCriteria: {
          DateFrom: dateFrom,
          DateTo: dateTo,
        },
        FieldNames: ["Impressions", "Clicks", "Cost", "Ctr"],
        ReportName: `gazebos_${dateFrom}_${dateTo}`,
        ReportType: "ACCOUNT_PERFORMANCE_REPORT",
        DateRangeType: "CUSTOM_DATE",
        Format: "TSV",
        IncludeVAT: "YES",
        IncludeDiscount: "NO",
      },
    };

    const res = await fetch(DIRECT_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Login": login,
        "Accept-Language": "ru",
        "Content-Type": "application/json; charset=utf-8",
        skipReportHeader: "true",
        skipColumnHeader: "true",
        skipReportSummary: "true",
        returnMoneyInMicros: "false",
      },
      body: JSON.stringify(body),
      next: { revalidate: 0 },
    });

    if (!res.ok) return { ...empty, configured: true };

    // TSV format: Impressions\tClicks\tCost\tCtr per line, last line is totals
    const text = await res.text();
    const lines = text.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return { ...empty, configured: true };

    // Last line is summary totals
    const parts = lines[lines.length - 1].split("\t");
    const impressions = parseInt(parts[0] ?? "0", 10) || 0;
    const clicks = parseInt(parts[1] ?? "0", 10) || 0;
    const cost = parseFloat(parts[2] ?? "0") || 0;
    const ctr = parseFloat(parts[3] ?? "0") || 0;

    return { impressions, clicks, cost, ctr, configured: true };
  } catch {
    return { ...empty, configured: true };
  }
}

export async function getYandexMetrikaStats(
  dateFrom: string,
  dateTo: string
): Promise<YandexMetrikaStats> {
  const empty: YandexMetrikaStats = {
    visits: 0,
    callsFromBusiness: 0,
    routesFromBusiness: 0,
    configured: false,
  };

  if (!isMetrikaConfigured()) return empty;

  const token = process.env.YANDEX_OAUTH_TOKEN!;
  const counterId = process.env.YANDEX_METRIKA_COUNTER_ID!;

  try {
    // Fetch visits and business events in parallel
    const [visitsRes, eventsRes] = await Promise.allSettled([
      fetch(
        `${METRIKA_API_URL}?ids=${counterId}&metrics=ym:s:visits&date1=${dateFrom}&date2=${dateTo}`,
        {
          headers: { Authorization: `OAuth ${token}` },
          next: { revalidate: 0 },
        }
      ),
      // Business events: make-call and make-route from Yandex Business card
      fetch(
        `${METRIKA_API_URL}?ids=${counterId}` +
          `&metrics=ym:s:goal%3Amake-call%3Avisits,ym:s:goal%3Amake-route%3Avisits` +
          `&date1=${dateFrom}&date2=${dateTo}`,
        {
          headers: { Authorization: `OAuth ${token}` },
          next: { revalidate: 0 },
        }
      ),
    ]);

    let visits = 0;
    if (visitsRes.status === "fulfilled" && visitsRes.value.ok) {
      const data = (await visitsRes.value.json()) as {
        data?: Array<{ metrics: number[] }>;
      };
      visits = data?.data?.[0]?.metrics?.[0] ?? 0;
    }

    let callsFromBusiness = 0;
    let routesFromBusiness = 0;
    if (eventsRes.status === "fulfilled" && eventsRes.value.ok) {
      const data = (await eventsRes.value.json()) as {
        data?: Array<{ metrics: number[] }>;
        totals?: number[];
      };
      callsFromBusiness = data?.totals?.[0] ?? 0;
      routesFromBusiness = data?.totals?.[1] ?? 0;
    }

    return { visits, callsFromBusiness, routesFromBusiness, configured: true };
  } catch {
    return { ...empty, configured: true };
  }
}

export async function getYandexMarketingStats(
  dateFrom: string,
  dateTo: string
): Promise<YandexMarketingStats> {
  const [direct, metrika] = await Promise.all([
    getYandexDirectStats(dateFrom, dateTo),
    getYandexMetrikaStats(dateFrom, dateTo),
  ]);

  return { direct, metrika, dateFrom, dateTo };
}
