/**
 * Обновляет объявления кампании "Аренда офисов" (709085563):
 *   - Создаёт 5 новых текстов с новыми вводными:
 *       • цена 1300 ₽/м²
 *       • стиль лофт
 *       • бесплатная охраняемая парковка
 *       • кафе, Плей Парк, беседки с барбекю на территории
 *   - Старые 2 ACCEPTED объявления уже в State=OFF — оставляем для истории
 *   - Новые отправляются на модерацию
 *
 * Запуск: node --env-file=.env --import tsx/esm scripts/refresh-offices-ads.ts
 */

const DIRECT_API = "https://api.direct.yandex.com/json/v5";
const APP_URL = "https://delovoy-park.ru";
const token = process.env.YANDEX_OAUTH_TOKEN!;
const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "ilya-sergeenko";

const CAMPAIGN_ID = 709085563;
const GROUP_ID = 5742730070;

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

function utm(content: string) {
  return `${APP_URL}/rental?utm_source=yandex&utm_medium=cpc&utm_campaign=offices&utm_term={keyword}&utm_content=${content}`;
}

const NEW_ADS: Array<{ title: string; title2: string; text: string; href: string }> = [
  // 1. Цена + лофт (сильный угол)
  {
    title:  "Лофт-офис от 1300 ₽/м²",
    title2: "Парковка, охрана, кафе",
    text:   "Бизнес-парк Деловой, Селятино: лофт-офисы. Кафе, беседки, бесплатная парковка.",
    href:   utm("offices_loft_price"),
  },
  // 2. Инфраструктура — главный отличитель
  {
    title:  "Офис в Селятино - 1300 ₽/м²",
    title2: "Кафе, барбекю, парковка",
    text:   "Деловой Парк: лофт-офисы, своё кафе и зона барбекю. Парковка бесплатно.",
    href:   utm("offices_infra"),
  },
  // 3. Стиль лофт впереди
  {
    title:  "Лофт-офисы в бизнес-парке",
    title2: "Селятино, от 1300 ₽/м²",
    text:   "Современные офисы в стиле лофт. Кафе, беседки, бесплатная парковка. Деловой Парк.",
    href:   utm("offices_loft_style"),
  },
  // 4. Парковка как УТП (для тех, кто на машинах)
  {
    title:  "Аренда офиса от 1300 ₽/м²",
    title2: "Бесплатная охраняемая парковка",
    text:   "Деловой Парк в Селятино: лофт-офисы. Кафе и зона барбекю на территории.",
    href:   utm("offices_parking"),
  },
  // 5. Геомаркер + размеры
  {
    title:  "Офисы в Селятино - лофт",
    title2: "1300 ₽/м², своя парковка",
    text:   "Бизнес-парк Деловой: лофт-офисы, охрана 24/7, кафе, барбекю. От 15 м².",
    href:   utm("offices_geo"),
  },
];

async function main() {
  // Валидация лимитов Директа
  for (const a of NEW_ADS) {
    if (a.title.length > 35)  throw new Error(`Title >35: "${a.title}" (${a.title.length})`);
    if (a.title2.length > 30) throw new Error(`Title2 >30: "${a.title2}" (${a.title2.length})`);
    if (a.text.length > 81)   throw new Error(`Text >81: "${a.text}" (${a.text.length})`);
  }
  console.log("✓ Длины ОК");
  for (const a of NEW_ADS) {
    console.log(`  T1(${a.title.length}) T2(${a.title2.length}) Txt(${a.text.length}): ${a.title}`);
  }

  console.log(`\n→ Создаю ${NEW_ADS.length} объявлений в группе ${GROUP_ID}…`);
  const adsPayload = NEW_ADS.map((a) => ({
    AdGroupId: GROUP_ID,
    TextAd: {
      Title: a.title, Title2: a.title2, Text: a.text, Href: a.href, Mobile: "NO",
    },
  }));
  const addResult = await req<{ AddResults: Array<{ Id?: number; Errors?: Array<{ Message: string; Details?: string }>; Warnings?: Array<{ Message: string }> }> }>(
    "ads", "add",
    { Ads: adsPayload }
  );
  const createdIds: number[] = [];
  for (let i = 0; i < addResult.AddResults.length; i++) {
    const r = addResult.AddResults[i];
    if (r.Id) {
      createdIds.push(r.Id);
      console.log(`  ✓ ${r.Id}: ${NEW_ADS[i].title}`);
      if (r.Warnings?.length) for (const w of r.Warnings) console.log(`     ⚠ ${w.Message}`);
    } else {
      console.error(`  ✗ "${NEW_ADS[i].title}": ${r.Errors?.[0]?.Message} — ${r.Errors?.[0]?.Details}`);
    }
  }

  if (createdIds.length) {
    console.log(`\n→ Отправляю ${createdIds.length} на модерацию…`);
    const modResult = await req<{ ModerateResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
      "ads", "moderate",
      { SelectionCriteria: { Ids: createdIds } }
    );
    const sent = modResult.ModerateResults.filter((r) => r.Id).length;
    console.log(`  ✓ Отправлено: ${sent}/${createdIds.length}`);
  }

  console.log(`\n✅ Готово. Создано ${createdIds.length}/${NEW_ADS.length}.`);
  console.log(`   IDs: ${createdIds.join(", ")}`);
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}\n`);
  process.exit(1);
});
