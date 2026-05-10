/**
 * Показывает текущие объявления и группы кампании "Аренда офисов" (709085563).
 */
const DIRECT_API = "https://api.direct.yandex.com/json/v5";
const token = process.env.YANDEX_OAUTH_TOKEN!;
const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "ilya-sergeenko";
const CAMPAIGN_ID = 709085563;

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

async function main() {
  console.log("\n━━━ Группы ━━━");
  const groups = await req<{ AdGroups?: Array<{ Id: number; Name: string; Status: string }> }>(
    "adgroups", "get",
    { SelectionCriteria: { CampaignIds: [CAMPAIGN_ID] }, FieldNames: ["Id", "Name", "Status"] }
  );
  for (const g of groups.AdGroups ?? []) console.log(`  ${g.Id}  ${g.Status}  ${g.Name}`);

  console.log("\n━━━ Объявления ━━━");
  const ads = await req<{ Ads?: Array<{ Id: number; AdGroupId: number; State: string; Status: string; TextAd?: { Title: string; Title2?: string; Text: string; Href?: string } }> }>(
    "ads", "get",
    { SelectionCriteria: { CampaignIds: [CAMPAIGN_ID] }, FieldNames: ["Id", "AdGroupId", "State", "Status"], TextAdFieldNames: ["Title", "Title2", "Text", "Href"] }
  );
  for (const a of ads.Ads ?? []) {
    if (!a.TextAd) continue;
    console.log(`\n  [${a.Id}] grp=${a.AdGroupId}  ${a.State}/${a.Status}`);
    console.log(`    T1:  ${a.TextAd.Title}`);
    console.log(`    T2:  ${a.TextAd.Title2 ?? ""}`);
    console.log(`    Txt: ${a.TextAd.Text}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
