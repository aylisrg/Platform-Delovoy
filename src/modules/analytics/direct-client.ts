import type { CampaignStats } from "./types";

const DIRECT_REPORTS_URL = "https://api.direct.yandex.com/json/v5/reports";
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT = 30_000;

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

    // First line is header
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
      };
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
