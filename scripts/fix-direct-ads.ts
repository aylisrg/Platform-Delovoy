/**
 * Досоздаёт объявления в уже существующих группах кампаний Беседки + PS Park.
 * Первый запуск setup:direct создал кампании, группы, ключи — но объявления
 * не сохранились из-за превышения лимита Text (81 символ).
 * Этот скрипт добавляет сокращённые версии объявлений + отправляет на модерацию.
 */

const DIRECT_API = "https://api.direct.yandex.com/json/v5";
const APP_URL = "https://delovoy-park.ru";
const token = process.env.YANDEX_OAUTH_TOKEN!;
const login = process.env.YANDEX_DIRECT_CLIENT_LOGIN || "ilya-sergeenko";

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

function utm(path: string, campaign: string, content: string) {
  return `${APP_URL}${path}?utm_source=yandex&utm_medium=cpc&utm_campaign=${campaign}&utm_term={keyword}&utm_content=${content}`;
}

// ═══ Маппинг: GroupId → объявления (A/B) ═══
// Все тексты ≤ 81 символа, заголовки ≤ 35, подзаголовки ≤ 30
const ADS_BY_GROUP: Record<number, Array<{ title: string; title2: string; text: string; href: string }>> = {
  // ─── БЕСЕДКИ ───────────────────────────────────────────────────
  5743244716: [ // Беседки — аренда (горячие)
    {
      title:  "Беседки с мангалом — аренда",
      title2: "Онлайн-бронь за 2 клика",
      text:   "Беседки от 4 до 20 чел. Мангал и дрова включены. Селятино, Деловой Парк.",
      href:   utm("/gazebos", "gazebos_hot", "rent_a"),
    },
    {
      title:  "Барбекю Парк — снять беседку",
      title2: "от 700 руб/час",
      text:   "5 беседок от 4 до 20 гостей. Мангал, дрова, парковка. Селятино, Деловой.",
      href:   utm("/gazebos", "gazebos_hot", "rent_b"),
    },
  ],
  5743244720: [ // Беседки — корпоратив
    {
      title:  "Корпоратив на природе",
      title2: "Беседки до 20 чел, всё есть",
      text:   "Корпоратив в Деловом Парке. Беседки с мангалом, дрова, парковка. Селятино.",
      href:   utm("/gazebos", "gazebos_corp", "corp_a"),
    },
    {
      title:  "День рождения на природе",
      title2: "Беседки с мангалом",
      text:   "Проведите праздник на природе! Беседки до 20 чел, мангал. Деловой Парк.",
      href:   utm("/gazebos", "gazebos_corp", "corp_b"),
    },
  ],
  5743244729: [ // Беседки — гео
    {
      title:  "Беседки в Селятино — аренда",
      title2: "Мангал и дрова включены",
      text:   "Барбекю Парк в Селятино. Беседки от 4 до 20 чел. Бронь онлайн, парковка.",
      href:   utm("/gazebos", "gazebos_geo", "geo_a"),
    },
    {
      title:  "Шашлыки в Селятино — беседки",
      title2: "от 700 руб/час",
      text:   "5 беседок с мангалом рядом с Селятино и Нарофоминском. Бронь онлайн.",
      href:   utm("/gazebos", "gazebos_geo", "geo_b"),
    },
  ],
  5743244737: [ // Беседки — майские
    {
      title:  "Беседки на майские праздники",
      title2: "Бронируйте — места тают",
      text:   "Беседки с мангалом на 1 и 9 мая! От 4 до 20 чел. Селятино, Деловой Парк.",
      href:   utm("/gazebos", "gazebos_may", "may_a"),
    },
    {
      title:  "Шашлыки на 1 мая — беседки",
      title2: "Мангал, дрова, парковка",
      text:   "Забронируйте беседку на майские! 5 вариантов от 700 руб/час. Селятино.",
      href:   utm("/gazebos", "gazebos_may", "may_b"),
    },
  ],
  // ─── PS PARK ───────────────────────────────────────────────────
  5743244782: [ // PS Park — аренда (горячие)
    {
      title:  "Плей Парк — аренда PS5",
      title2: "FIFA, гонки, приключения",
      text:   "4 стола с PS5, мониторы до 65. Аренда от 1 часа. Селятино, Деловой Парк.",
      href:   utm("/ps-park", "pspark_hot", "ps_a"),
    },
    {
      title:  "PlayStation 5 по часам",
      title2: "Экраны 55-65, от 800 руб",
      text:   "PS5, до 6 геймпадов, большие экраны. Для компании. Плей Парк, Селятино.",
      href:   utm("/ps-park", "pspark_hot", "ps_b"),
    },
  ],
  5743244787: [ // PS Park — клуб
    {
      title:  "Игровой клуб с PS5",
      title2: "4 стола, большие экраны",
      text:   "Плей Парк — игровая зона с PS5. FIFA, гонки. Аренда от 1 часа. Селятино.",
      href:   utm("/ps-park", "pspark_club", "club_a"),
    },
    {
      title:  "Плей Парк — игровая зона",
      title2: "PS5, от 800 руб/час",
      text:   "Игровой клуб с PS5 в Селятино. 4 стола, мониторы до 65. Бронь онлайн.",
      href:   utm("/ps-park", "pspark_club", "club_b"),
    },
  ],
  5743244794: [ // PS Park — дети
    {
      title:  "PS5 для детей и взрослых",
      title2: "от 1 часа, бронь онлайн",
      text:   "Плей Парк — игровая зона с PS5 для детей от 6 лет. FIFA, гонки. Селятино.",
      href:   utm("/ps-park", "pspark_kids", "kids_a"),
    },
    {
      title:  "Игровая зона для детей",
      title2: "PlayStation 5, экраны",
      text:   "Развлечение для детей и подростков! PS5, 4 стола. От 800 руб/час.",
      href:   utm("/ps-park", "pspark_kids", "kids_b"),
    },
  ],
  5743244798: [ // PS Park — гео
    {
      title:  "Плей Парк в Селятино — PS5",
      title2: "Бронируйте стол онлайн",
      text:   "Аренда PS5 по часам в Селятино. 4 стола, мониторы до 65. Деловой Парк.",
      href:   utm("/ps-park", "pspark_geo", "geo_a"),
    },
    {
      title:  "PS5 в Селятино — от 800 руб",
      title2: "FIFA, гонки, большие экраны",
      text:   "Игровая зона с PS5 рядом с Нарофоминском. 4 стола, 6 геймпадов.",
      href:   utm("/ps-park", "pspark_geo", "geo_b"),
    },
  ],
};

async function main() {
  // Валидация лимитов
  for (const [groupId, ads] of Object.entries(ADS_BY_GROUP)) {
    for (const ad of ads) {
      if (ad.title.length > 35)  throw new Error(`Title >35: "${ad.title}" (${ad.title.length})`);
      if (ad.title2.length > 30) throw new Error(`Title2 >30: "${ad.title2}" (${ad.title2.length})`);
      if (ad.text.length > 81)   throw new Error(`Text >81 в группе ${groupId}: "${ad.text}" (${ad.text.length})`);
    }
  }
  console.log("✓ Все длины в лимитах\n");

  // Создание объявлений
  const adsPayload = Object.entries(ADS_BY_GROUP).flatMap(([groupId, ads]) =>
    ads.map((ad) => ({
      AdGroupId: Number(groupId),
      TextAd: {
        Title:  ad.title,
        Title2: ad.title2,
        Text:   ad.text,
        Href:   ad.href,
        Mobile: "NO",
      },
    }))
  );

  console.log(`Создаю ${adsPayload.length} объявлений...`);
  const result = await req<{ AddResults: Array<{ Id?: number; Errors?: Array<{ Message: string; Details?: string }>; Warnings?: Array<{ Message: string }> }> }>(
    "ads", "add",
    { Ads: adsPayload }
  );

  const createdIds: number[] = [];
  let errors = 0;
  for (let i = 0; i < result.AddResults.length; i++) {
    const r = result.AddResults[i];
    if (r.Id) {
      createdIds.push(r.Id);
    } else {
      errors++;
      console.error(`  ✗ Объявление ${i + 1}: ${r.Errors?.[0]?.Message} — ${r.Errors?.[0]?.Details}`);
    }
  }
  console.log(`✓ Создано: ${createdIds.length}, ошибок: ${errors}\n`);

  if (createdIds.length === 0) {
    console.error("Нечего отправлять на модерацию");
    process.exit(1);
  }

  // Отправка на модерацию
  console.log(`Отправляю ${createdIds.length} объявлений на модерацию...`);
  const modResult = await req<{ ModerateResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "ads", "moderate",
    { SelectionCriteria: { Ids: createdIds } }
  );

  let sent = 0;
  let modErrors = 0;
  for (const r of modResult.ModerateResults) {
    if (r.Id) sent++;
    else modErrors++;
  }
  console.log(`✓ Отправлено на модерацию: ${sent}, ошибок: ${modErrors}\n`);

  // Включаем кампании (они сейчас в DRAFT/OFF)
  console.log("Запускаю кампании (resume)...");
  const resumeResult = await req<{ ResumeResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "campaigns", "resume",
    { SelectionCriteria: { Ids: [709135109, 709135118] } }
  );
  console.log(JSON.stringify(resumeResult, null, 2));

  console.log("\n✅ Готово! Объявления на модерации Яндекса (~2-4 часа).");
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}\n`);
  process.exit(1);
});
