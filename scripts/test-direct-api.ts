/**
 * Проверяет подключение к Яндекс.Директ API и выводит инфо об аккаунте.
 * Запуск: npm run test:direct
 */

const DIRECT_API = "https://api.direct.yandex.com/json/v5";
const token = process.env.YANDEX_OAUTH_TOKEN;

if (!token) {
  console.error("❌  Не задан YANDEX_OAUTH_TOKEN в .env");
  process.exit(1);
}

async function directRequest(service: string, method: string, params: object, clientLogin?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
    "Accept-Language": "ru",
  };
  if (clientLogin) headers["Client-Login"] = clientLogin;

  const res = await fetch(`${DIRECT_API}/${service}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ method, params }),
  });

  const data = await res.json() as { result?: unknown; error?: { error_code: number; error_string: string; error_detail: string } };

  if (data.error) {
    throw new Error(`Direct API [${service}.${method}] ${data.error.error_code}: ${data.error.error_string} — ${data.error.error_detail}`);
  }

  return data.result;
}

async function main() {
  console.log("\n🔌  Проверка подключения к Яндекс.Директ API\n");

  // 1. Получаем инфо об аккаунте (логин берём из API — не нужно вводить вручную)
  console.log("1️⃣   Получаем данные аккаунта...");
  const clientsResult = await directRequest("clients", "get", {
    FieldNames: ["Login", "ClientId", "Currency", "Restrictions", "Notification"],
  }) as { Clients: Array<{ Login: string; ClientId: number; Currency: string; Restrictions: Array<{ Element: string; Value: number }> }> };

  const client = clientsResult.Clients[0];
  console.log(`     ✅  Логин:    ${client.Login}`);
  console.log(`     ✅  ID:       ${client.ClientId}`);
  console.log(`     ✅  Валюта:   ${client.Currency}`);

  const dayBudgetLimit = client.Restrictions?.find(r => r.Element === "CAMPAIGN_DAY_BUDGET_AMOUNT_MIN");
  if (dayBudgetLimit) {
    console.log(`     ✅  Мин. дневной бюджет: ${dayBudgetLimit.Value / 1_000_000} ${client.Currency}`);
  }

  // Сохраняем логин для следующих запросов
  const login = client.Login;

  // 2. Проверяем существующие кампании
  console.log("\n2️⃣   Получаем существующие кампании...");
  const campaignsResult = await directRequest("campaigns", "get", {
    SelectionCriteria: {},
    FieldNames: ["Id", "Name", "State", "Status", "Type"],
  }, login) as { Campaigns?: Array<{ Id: number; Name: string; State: string; Status: string; Type: string }> };

  const campaigns = campaignsResult.Campaigns ?? [];
  if (campaigns.length === 0) {
    console.log("     📭  Кампаний пока нет");
  } else {
    console.log(`     📋  Найдено кампаний: ${campaigns.length}`);
    for (const c of campaigns) {
      console.log(`        • [${c.Id}] ${c.Name} — ${c.State} / ${c.Status}`);
    }
  }

  // 3. Проверяем регионы (убеждаемся что геотаргетинг доступен)
  console.log("\n3️⃣   Проверяем доступ к геотаргетингу...");
  const regionsResult = await directRequest("dictionaries", "get", {
    DictionaryNames: ["GeoRegions"],
  }) as { GeoRegions: Array<{ GeoRegionId: number; GeoRegionName: string; GeoRegionType: string }> };

  const regions = regionsResult.GeoRegions;
  const targetRegions = [
    { name: "Москва", id: 1 },
    { name: "Московская область", id: 10650 },
    { name: "Нарофоминский район", id: 116980 },
  ];
  for (const r of targetRegions) {
    const found = regions.find(gr => gr.GeoRegionId === r.id);
    console.log(`     ${found ? "✅" : "❌"}  ${r.name} (ID: ${r.id})${found ? ` — ${found.GeoRegionType}` : " — не найден"}`);
  }

  console.log(`\n✨  Всё работает! Логин для YANDEX_DIRECT_CLIENT_LOGIN: ${login}\n`);
  console.log(`   Добавь в .env:`);
  console.log(`   YANDEX_DIRECT_CLIENT_LOGIN="${login}"\n`);
}

main().catch((err) => {
  console.error(`\n❌  ${(err as Error).message}\n`);
  process.exit(1);
});
