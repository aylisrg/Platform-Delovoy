import type { CampaignStats, AccountBalance } from "./types";

const DIRECT_BASE_URL = "https://api.direct.yandex.com/json/v5";
const DIRECT_REPORTS_URL = `${DIRECT_BASE_URL}/reports`;
const DIRECT_AGENCY_CLIENTS_URL = `${DIRECT_BASE_URL}/agencyclients`;
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT = 30_000;
const BALANCE_REQUEST_TIMEOUT = 10_000;

type AgencyClientsResponse = {
  result?: {
    Clients?: Array<{
      Login?: string;
      Currency?: string;
      AccountQuality?: number;
      Settings?: Array<{ Option: string; Value: string }>;
    }>;
  };
  error?: { error_string?: string; error_detail?: string; error_code?: number };
};

export class DirectClient {
  constructor(
    private readonly oauthToken: string,
    private readonly clientLogin: string
  ) {}

  async getCampaignStats(dateFrom: string, dateTo: string): Promise<CampaignStats[]> {
    const reportBody = {
      params: {
        SelectionCriteria: { DateFrom: dateFrom, DateTo: dateTo },
        FieldNames: [
          "CampaignId",
          "CampaignName",
          "CampaignStatus",
          "Impressions",
          "Clicks",
          "Ctr",
          "Cost",
          "AvgCpc",
        ],
        ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
        DateRangeType: "CUSTOM_DATE",
        ReportName: `analytics-${dateFrom}-${dateTo}-${Date.now()}`,
        Format: "TSV",
        IncludeVAT: "YES",
        IncludeDiscount: "NO",
      },
    };

    const tsv = await this.requestReport(reportBody);
    return this.parseTsvReport(tsv);
  }

  /**
   * Fetches account balance via agencyclients endpoint.
   * Works only when OAuth token belongs to an agency that manages clientLogin.
   * For direct (non-agency) customers, returns "unavailable" with guidance.
   */
  async getAccountBalance(manualBalance: string | undefined): Promise<AccountBalance> {
    const manualParsed = parseManualBalance(manualBalance);
    const fallback: AccountBalance = manualParsed
      ? {
          amount: manualParsed,
          currency: "RUB",
          source: "manual_env",
          message: "Значение из YANDEX_DIRECT_BALANCE_MANUAL",
        }
      : {
          amount: null,
          currency: "RUB",
          source: "unavailable",
          message:
            "Баланс недоступен через API: токен не агентский. Задайте YANDEX_DIRECT_BALANCE_MANUAL для ручного отображения.",
        };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BALANCE_REQUEST_TIMEOUT);

    try {
      const res = await fetch(DIRECT_AGENCY_CLIENTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.oauthToken}`,
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json",
          "Accept-Language": "ru",
        },
        body: JSON.stringify({
          method: "get",
          params: {
            SelectionCriteria: { Logins: [this.clientLogin] },
            FieldNames: ["Login", "Currency", "AccountQuality"],
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) return fallback;

      const data = (await res.json()) as AgencyClientsResponse;
      if (data.error) return fallback;

      const client = data.result?.Clients?.[0];
      if (!client) return fallback;

      // AccountQuality is a 0–100 health metric (not balance). Without finance_token,
      // we cannot reliably fetch raw balance via v5. Surface manual env if set,
      // otherwise mark as unavailable but include currency from the API.
      const currency = client.Currency ?? "RUB";

      if (manualParsed !== null) {
        return {
          amount: manualParsed,
          currency,
          source: "manual_env",
          message: "Значение из YANDEX_DIRECT_BALANCE_MANUAL",
        };
      }

      return {
        amount: null,
        currency,
        source: "unavailable",
        message:
          "Баланс через v5 API недоступен (требуется finance_token). Задайте YANDEX_DIRECT_BALANCE_MANUAL.",
      };
    } catch {
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestReport(body: object): Promise<string> {
    let retries = 0;

    while (retries < MAX_RETRIES) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      try {
        const res = await fetch(DIRECT_REPORTS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.oauthToken}`,
            "Client-Login": this.clientLogin,
            "Content-Type": "application/json; charset=utf-8",
            Accept: "application/json",
            returnMoneyInMicros: "false",
            skipReportHeader: "true",
            skipReportSummary: "true",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (res.status === 200) {
          return await res.text();
        }

        if (res.status === 201 || res.status === 202) {
          const retryIn = parseInt(res.headers.get("retryIn") ?? "5", 10);
          await this.sleep(retryIn * 1000);
          retries++;
          continue;
        }

        const text = await res.text().catch(() => "");
        throw new Error(`YANDEX_DIRECT_ERROR: ${res.status} ${text}`);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error("YANDEX_DIRECT_ERROR: Report generation timed out after retries");
  }

  private parseTsvReport(tsv: string): CampaignStats[] {
    const lines = tsv.trim().split("\n");
    if (lines.length < 2) return [];

    return lines.slice(1).map((line) => {
      const cols = line.split("\t");
      return {
        campaignId: parseInt(cols[0] ?? "0", 10),
        campaignName: cols[1] ?? "",
        status: cols[2] ?? "UNKNOWN",
        impressions: parseInt(cols[3] ?? "0", 10),
        clicks: parseInt(cols[4] ?? "0", 10),
        ctr: parseFloat(cols[5] ?? "0"),
        cost: parseFloat(cols[6] ?? "0"),
        avgCpc: parseFloat(cols[7] ?? "0"),
        costShare: 0,
      };
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function parseManualBalance(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
