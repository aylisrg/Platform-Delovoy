/**
 * Показывает текущую стратегию и KeyGoals кампании "Аренда офисов" (709085563),
 * а также количество конверсий по цели office_inquiry_success за 30 и 90 дней.
 */
const DIRECT_API = "https://api.direct.yandex.com/json/v5";
const REPORTS_API = "https://api.direct.yandex.com/json/v5/reports";
const token = process.env.YANDEX_OAUTH_TOKEN!;
const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "ilya-sergeenko";
const CAMPAIGN_ID = 709085563;
const COUNTER_ID = process.env.YANDEX_METRIKA_COUNTER_ID || "73068007";
const OFFICE_SUCCESS_GOAL_ID = 546518894;

async function direct<T = unknown>(service: string, method: string, params: object): Promise<T> {
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
    if (res.status === 200) return await res.text();
    if (res.status === 201 || res.status === 202) { await new Promise((r) => setTimeout(r, 3000)); continue; }
    throw new Error(`Reports ${res.status}: ${await res.text()}`);
  }
}

async function main() {
  // ─── 1. Стратегия + KeyGoals + бюджет ───
  console.log("\n━━━ Кампания: настройки ━━━");
  const camp = await direct<{ Campaigns?: Array<{ Id: number; Name: string; DailyBudget?: { Amount: number; Mode: string }; TextCampaign?: { BiddingStrategy?: unknown; PriorityGoals?: { Items: Array<{ GoalId: number; Value: number }> } } }> }>(
    "campaigns", "get",
    {
      SelectionCriteria: { Ids: [CAMPAIGN_ID] },
      FieldNames: ["Id", "Name", "DailyBudget"],
      TextCampaignFieldNames: ["BiddingStrategy", "PriorityGoals"],
    }
  );
  for (const c of camp.Campaigns ?? []) {
    console.log(`  ${c.Id}  ${c.Name}`);
    console.log(`  Дневной бюджет:`, c.DailyBudget ? `${c.DailyBudget.Amount / 1_000_000} ₽ (${c.DailyBudget.Mode})` : "не задан (=без лимита кампании)");
    console.log(`  Стратегия:`, JSON.stringify(c.TextCampaign?.BiddingStrategy, null, 2));
    console.log(`  KeyGoals (приоритетные цели):`);
    for (const g of c.TextCampaign?.PriorityGoals?.Items ?? []) {
      console.log(`    GoalId=${g.GoalId}  Value=${g.Value / 1_000_000} ₽`);
    }
  }

  // ─── 2. Конверсии по цели office_inquiry_success ───
  console.log("\n━━━ Конверсии: office_inquiry_success ━━━");
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();
  const periods: Array<{ name: string; days: number }> = [
    { name: "Последние 30 дней", days: 30 },
    { name: "Последние 90 дней", days: 90 },
  ];
  for (const p of periods) {
    const start = new Date(); start.setDate(today.getDate() - p.days);
    const csv = await report({
      params: {
        SelectionCriteria: {
          DateFrom: fmt(start), DateTo: fmt(today),
          Filter: [{ Field: "CampaignId", Operator: "EQUALS", Values: [String(CAMPAIGN_ID)] }],
        },
        FieldNames: ["Date", "Impressions", "Clicks", "Cost", "Conversions", "CostPerConversion"],
        Goals: [String(OFFICE_SUCCESS_GOAL_ID)],
        ReportName: `offices-conv-${p.days}-${Date.now()}`,
        ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
        DateRangeType: "CUSTOM_DATE",
        Format: "TSV",
        IncludeVAT: "YES",
      },
    });
    console.log(`\n  ${p.name}:`);
    console.log(csv || "  (нет данных)");
  }
}
main().catch((e) => { console.error(`\n❌ ${e.message}\n`); process.exit(1); });
