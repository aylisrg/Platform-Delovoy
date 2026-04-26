/**
 * Отчёт по кампании Плей Парк в Яндекс.Директ.
 * Берёт статистику за последние 14 дней по объявлениям и группам.
 *
 * Запуск: node --env-file=.env --import tsx/esm scripts/stats-pspark-direct.ts
 */

const DIRECT_API = "https://api.direct.yandex.com/json/v5";
const REPORTS_API = "https://api.direct.yandex.com/json/v5/reports";
const token = process.env.YANDEX_OAUTH_TOKEN!;
const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "ilya-sergeenko";

const PSPARK_CAMPAIGN_ID = 709135118;

async function req<T = unknown>(service: string, method: string, params: object): Promise<T> {
  const res = await fetch(`${DIRECT_API}/${service}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "Accept-Language": "ru",
      "Client-Login": login,
    },
    body: JSON.stringify({ method, params }),
  });
  const data = await res.json() as { result?: T; error?: { error_string: string; error_detail: string } };
  if (data.error) throw new Error(`${service}.${method}: ${data.error.error_string} — ${data.error.error_detail}`);
  return data.result as T;
}

async function report(body: object): Promise<string> {
  while (true) {
    const res = await fetch(REPORTS_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
        "Accept-Language": "ru",
        "Client-Login": login,
        processingMode: "auto",
        returnMoneyInMicros: "false",
        skipReportHeader: "true",
        skipReportSummary: "true",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 200 || res.status === 201 || res.status === 202) {
      if (res.status === 200) return await res.text();
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    const txt = await res.text();
    throw new Error(`Reports ${res.status}: ${txt}`);
  }
}

async function main() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 14);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  console.log(`\n  Плей Парк — статистика Директа ${fmt(start)} … ${fmt(end)}\n`);

  // ───── 1. Сводка по кампании ─────
  console.log("━━━ Кампания целиком");
  const campCsv = await report({
    params: {
      SelectionCriteria: { DateFrom: fmt(start), DateTo: fmt(end), Filter: [{ Field: "CampaignId", Operator: "EQUALS", Values: [String(PSPARK_CAMPAIGN_ID)] }] },
      FieldNames: ["Date", "Impressions", "Clicks", "Cost", "Ctr", "AvgCpc"],
      ReportName: `pspark-camp-${Date.now()}`,
      ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
      DateRangeType: "CUSTOM_DATE",
      Format: "TSV",
      IncludeVAT: "YES",
    },
  });
  console.log(campCsv || "(нет данных)");

  // ───── 2. По группам ─────
  console.log("\n━━━ По группам объявлений");
  const groupCsv = await report({
    params: {
      SelectionCriteria: { DateFrom: fmt(start), DateTo: fmt(end), Filter: [{ Field: "CampaignId", Operator: "EQUALS", Values: [String(PSPARK_CAMPAIGN_ID)] }] },
      FieldNames: ["AdGroupId", "AdGroupName", "Impressions", "Clicks", "Cost", "Ctr", "AvgCpc"],
      ReportName: `pspark-grp-${Date.now()}`,
      ReportType: "ADGROUP_PERFORMANCE_REPORT",
      DateRangeType: "CUSTOM_DATE",
      Format: "TSV",
      IncludeVAT: "YES",
    },
  });
  console.log(groupCsv || "(нет данных)");

  // ───── 3. По объявлениям ─────
  console.log("\n━━━ По объявлениям");
  const adCsv = await report({
    params: {
      SelectionCriteria: { DateFrom: fmt(start), DateTo: fmt(end), Filter: [{ Field: "CampaignId", Operator: "EQUALS", Values: [String(PSPARK_CAMPAIGN_ID)] }] },
      FieldNames: ["AdId", "AdGroupName", "Impressions", "Clicks", "Cost", "Ctr"],
      ReportName: `pspark-ad-${Date.now()}`,
      ReportType: "AD_PERFORMANCE_REPORT",
      DateRangeType: "CUSTOM_DATE",
      Format: "TSV",
      IncludeVAT: "YES",
    },
  });
  console.log(adCsv || "(нет данных)");

  // ───── 4. По ключевым фразам ─────
  console.log("\n━━━ Топ ключевых фраз");
  const kwCsv = await report({
    params: {
      SelectionCriteria: { DateFrom: fmt(start), DateTo: fmt(end), Filter: [{ Field: "CampaignId", Operator: "EQUALS", Values: [String(PSPARK_CAMPAIGN_ID)] }] },
      FieldNames: ["Criterion", "AdGroupName", "Impressions", "Clicks", "Cost", "Ctr"],
      ReportName: `pspark-kw-${Date.now()}`,
      ReportType: "CRITERIA_PERFORMANCE_REPORT",
      DateRangeType: "CUSTOM_DATE",
      Format: "TSV",
      IncludeVAT: "YES",
    },
  });
  console.log(kwCsv || "(нет данных)");

  // ───── 5. Текущие объявления (тексты) ─────
  console.log("\n━━━ Активные тексты объявлений");
  const ads = await req<{ Ads?: Array<{ Id: number; AdGroupId: number; State: string; Status: string; TextAd?: { Title: string; Title2?: string; Text: string; Href?: string } }> }>(
    "ads", "get",
    {
      SelectionCriteria: { CampaignIds: [PSPARK_CAMPAIGN_ID] },
      FieldNames: ["Id", "AdGroupId", "State", "Status"],
      TextAdFieldNames: ["Title", "Title2", "Text", "Href"],
    }
  );
  for (const a of ads.Ads ?? []) {
    if (!a.TextAd) continue;
    console.log(`\n  [${a.Id}] group=${a.AdGroupId} ${a.State}/${a.Status}`);
    console.log(`    T1:  ${a.TextAd.Title}`);
    console.log(`    T2:  ${a.TextAd.Title2 ?? ""}`);
    console.log(`    Txt: ${a.TextAd.Text}`);
  }
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}\n`);
  process.exit(1);
});
