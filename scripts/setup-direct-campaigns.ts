/**
 * Создаёт рекламные кампании в Яндекс.Директ через API v5.
 * Запуск: npm run setup:direct
 *
 * Создаёт:
 *   - 3 кампании: Беседки, PS Park, Офисы
 *   - Группы объявлений с геотаргетингом
 *   - Ключевые слова с минус-словами
 *   - По 2 объявления на группу (A/B тест)
 *   - UTM-метки на всех ссылках
 *   - Привязку к Яндекс.Метрике
 */

const DIRECT_API = "https://api.direct.yandex.com/json/v5";
const APP_URL = "https://delovoy-park.ru";
const METRIKA_COUNTER_ID = Number(process.env.YANDEX_METRIKA_COUNTER_ID || "73068007");

// ─── Дневные бюджеты (рублей) ─────────────────────────────────────
const BUDGETS = {
  gazebos: 500,   // беседки -сезонный трафик
  pspark:  300,   // PS Park -стабильный трафик
  offices: 800,   // офисы -высокий LTV
};

// ─── Геотаргетинг ─────────────────────────────────────────────────
// Нарофоминский округ + соседние города (в радиусе ~30 км от Селятино)
const REGIONS_LOCAL = [
  98597,  // Наро-Фоминский городской округ (Селятино входит сюда)
  10741,  // Нарофоминск
  10715,  // Апрелевка
  21625,  // Кубинка
  21647,  // Краснознаменск
];
// Для офисов (B2B) — добавляем Москву и Одинцово, т.к. бизнес ищет шире
const REGIONS_MOSCOW = [
  ...REGIONS_LOCAL,
  1,      // Москва и Московская область
];

// ─── Старт кампаний ───────────────────────────────────────────────
const START_DATE = new Date().toISOString().split("T")[0]; // сегодня

const token = process.env.YANDEX_OAUTH_TOKEN;
if (!token) {
  console.error("❌  Не задан YANDEX_OAUTH_TOKEN в .env");
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════
// API хелпер
// ═══════════════════════════════════════════════════════════════════

async function directRequest<T>(
  service: string,
  method: string,
  params: object,
  clientLogin: string
): Promise<T> {
  const res = await fetch(`${DIRECT_API}/${service}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "Accept-Language": "ru",
      "Client-Login": clientLogin,
    },
    body: JSON.stringify({ method, params }),
  });

  const data = await res.json() as {
    result?: T;
    error?: { error_code: number; error_string: string; error_detail: string };
  };

  if (data.error) {
    throw new Error(
      `[${service}.${method}] ${data.error.error_code}: ${data.error.error_string} -${data.error.error_detail}`
    );
  }

  return data.result as T;
}

// Рубли → микры (формат Яндекса)
const rub = (amount: number) => amount * 1_000_000;

// ═══════════════════════════════════════════════════════════════════
// Получение логина
// ═══════════════════════════════════════════════════════════════════

async function getClientLogin(): Promise<string> {
  // Первый запрос без Client-Login -возвращает данные текущего пользователя
  const res = await fetch(`${DIRECT_API}/clients`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "Accept-Language": "ru",
    },
    body: JSON.stringify({
      method: "get",
      params: { FieldNames: ["Login", "ClientId", "Currency"] },
    }),
  });

  const data = await res.json() as {
    result?: { Clients: Array<{ Login: string; ClientId: number; Currency: string }> };
    error?: { error_code: number; error_string: string; error_detail: string };
  };

  if (data.error) {
    throw new Error(`Ошибка авторизации: ${data.error.error_string} -${data.error.error_detail}`);
  }

  return data.result!.Clients[0].Login;
}

// ═══════════════════════════════════════════════════════════════════
// Проверка существующих кампаний (идемпотентность)
// ═══════════════════════════════════════════════════════════════════

async function getExistingCampaignNames(login: string): Promise<Set<string>> {
  const result = await directRequest<{ Campaigns?: Array<{ Name: string }> }>(
    "campaigns", "get",
    { SelectionCriteria: {}, FieldNames: ["Name"] },
    login
  );
  return new Set((result.Campaigns ?? []).map((c) => c.Name));
}

// ═══════════════════════════════════════════════════════════════════
// Создание кампании
// ═══════════════════════════════════════════════════════════════════

async function createCampaign(login: string, config: {
  name: string;
  dailyBudget: number;
  negativeKeywords?: string[];
}): Promise<number> {
  const result = await directRequest<{ AddResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "campaigns", "add",
    {
      Campaigns: [{
        Name: config.name,
        StartDate: START_DATE,
        TextCampaign: {
          BiddingStrategy: {
            Search: {
              BiddingStrategyType: "WB_MAXIMUM_CLICKS",
              WbMaximumClicks: {
                WeeklySpendLimit: rub(config.dailyBudget * 7),
                BidCeiling: rub(150),
              },
            },
            Network: {
              BiddingStrategyType: "SERVING_OFF",
            },
          },
          Settings: [
            { Option: "ADD_METRICA_TAG", Value: "YES" },
            { Option: "REQUIRE_SERVICING", Value: "NO" },
          ],
          CounterIds: { Items: [METRIKA_COUNTER_ID] },
        },
      }],
    },
    login
  );

  const r = result.AddResults[0];
  if (!r.Id) throw new Error(`Ошибка создания кампании "${config.name}": ${r.Errors?.[0]?.Message}`);
  return r.Id;
}

// ═══════════════════════════════════════════════════════════════════
// Создание группы объявлений
// ═══════════════════════════════════════════════════════════════════

async function createAdGroup(login: string, config: {
  name: string;
  campaignId: number;
  regionIds: number[];
  negativeKeywords?: string[];
}): Promise<number> {
  const result = await directRequest<{ AddResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "adgroups", "add",
    {
      AdGroups: [{
        Name: config.name,
        CampaignId: config.campaignId,
        RegionIds: config.regionIds,
        NegativeKeywords: config.negativeKeywords?.length
          ? { Items: config.negativeKeywords }
          : undefined,
      }],
    },
    login
  );

  const r = result.AddResults[0];
  if (!r.Id) throw new Error(`Ошибка создания группы "${config.name}": ${r.Errors?.[0]?.Message}`);
  return r.Id;
}

// ═══════════════════════════════════════════════════════════════════
// Добавление ключевых слов
// ═══════════════════════════════════════════════════════════════════

async function addKeywords(login: string, adGroupId: number, keywords: string[]): Promise<void> {
  await directRequest(
    "keywords", "add",
    {
      Keywords: keywords.map((kw) => ({
        AdGroupId: adGroupId,
        Keyword: kw,
      })),
    },
    login
  );
}

// ═══════════════════════════════════════════════════════════════════
// Создание объявлений
// ═══════════════════════════════════════════════════════════════════

async function addAds(login: string, adGroupId: number, ads: Array<{
  title: string;   // до 35 символов
  title2: string;  // до 30 символов
  text: string;    // до 81 символа
  href: string;
}>): Promise<void> {
  await directRequest(
    "ads", "add",
    {
      Ads: ads.map((ad) => ({
        AdGroupId: adGroupId,
        TextAd: {
          Title:  ad.title,
          Title2: ad.title2,
          Text:   ad.text,
          Href:   ad.href,
          Mobile: "NO",
        },
      })),
    },
    login
  );
}

// ═══════════════════════════════════════════════════════════════════
// UTM-ссылки
// ═══════════════════════════════════════════════════════════════════

function utm(path: string, campaign: string) {
  return `${APP_URL}${path}?utm_source=yandex&utm_medium=cpc&utm_campaign=${campaign}&utm_term={keyword}&utm_content={ad_id}`;
}

// ═══════════════════════════════════════════════════════════════════
// ДАННЫЕ КАМПАНИЙ
// ═══════════════════════════════════════════════════════════════════

const CAMPAIGNS = [

  // ──────────────────────────────────────────────────────────────
  // 1. БЕСЕДКИ / БАРБЕКЮ ПАРК
  // ──────────────────────────────────────────────────────────────
  {
    campaign: {
      name: "Деловой Парк - Беседки и Барбекю",
      dailyBudget: BUDGETS.gazebos,
      negativeKeywords: ["купить", "продать", "дача", "своя", "построить", "проект", "своими руками", "чертёж"],
    },
    group: {
      name: "Беседки - аренда",
      regionIds: REGIONS_LOCAL,
      negativeKeywords: ["бесплатно"],
    },
    keywords: [
      "аренда беседки",
      "беседка с мангалом аренда",
      "снять беседку на природе",
      "беседка для компании",
      "барбекю площадка аренда",
      "беседка Московская область аренда",
      "беседка выходные аренда",
      "беседка корпоратив",
      "беседка Нарофоминск",
      "беседка Селятино",
    ],
    ads: [
      {
        title:  "Беседки с мангалом -аренда",
        title2: "Онлайн-бронирование за 2 клика",
        text:   "Беседки до 20 чел. Мангал включён. Бизнес-парк Деловой, Селятино.",
        href:   utm("/gazebos", "gazebos"),
      },
      {
        title:  "Барбекю Парк -снять беседку",
        title2: "Мангал, дрова -всё включено",
        text:   "Беседки от 2 до 20 человек. Парковка рядом. Бизнес-парк Деловой, Селятино.",
        href:   utm("/gazebos", "gazebos_b"),
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────
  // 2. PS PARK
  // ──────────────────────────────────────────────────────────────
  {
    campaign: {
      name: "Деловой Парк - Плей Парк PS5",
      dailyBudget: BUDGETS.pspark,
      negativeKeywords: ["купить", "продать", "магазин", "онлайн игра", "скачать"],
    },
    group: {
      name: "PS Park - аренда",
      regionIds: REGIONS_LOCAL,
      negativeKeywords: ["бесплатно", "взломать"],
    },
    keywords: [
      "PlayStation аренда",
      "PS5 аренда",
      "прокат PlayStation",
      "игровой клуб",
      "игровая зона аренда часа",
      "PlayStation Park",
      "аренда PlayStation Подмосковье",
      "игровая комната дети",
      "PS5 по часам",
      "Плей Парк Селятино",
    ],
    ads: [
      {
        title:  "PlayStation Park -аренда PS5",
        title2: "FIFA, гонки, приключения",
        text:   "Аренда столов с PS5 по часам. Бизнес-парк Деловой, Селятино.",
        href:   utm("/ps-park", "pspark"),
      },
      {
        title:  "Плей Парк -PS5 по часам",
        title2: "Для детей и взрослых",
        text:   "FIFA, гоночные симуляторы, приключения. Онлайн-бронирование. Селятино.",
        href:   utm("/ps-park", "pspark_b"),
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────
  // 3. ОФИСЫ В АРЕНДУ
  // ──────────────────────────────────────────────────────────────
  {
    campaign: {
      name: "Деловой Парк - Аренда офисов",
      dailyBudget: BUDGETS.offices,
      negativeKeywords: ["купить", "жилой", "апартаменты", "квартира", "склад", "гараж", "бесплатно"],
    },
    group: {
      name: "Офисы - аренда",
      regionIds: REGIONS_MOSCOW, // + Москва, т.к. B2B аудитория шире
      negativeKeywords: ["субаренда", "посуточно"],
    },
    keywords: [
      "аренда офиса Селятино",
      "снять офис Нарофоминск",
      "офис в аренду бизнес-парк",
      "аренда офиса Московская область",
      "офис для компании аренда",
      "бизнес центр аренда офис",
      "офис с парковкой аренда",
      "коммерческая недвижимость офис аренда",
      "офис Подмосковье недорого",
      "снять офис от 15 кв м",
    ],
    ads: [
      {
        title:  "Офисы в аренду -Селятино",
        title2: "От 15 м², договор от 1 месяца",
        text:   "Офисы от 15 м². Охрана 24/7, парковка, кафе в здании. Посмотрите планировку.",
        href:   utm("/rental", "offices"),
      },
      {
        title:  "Аренда офиса в бизнес-парке",
        title2: "Охрана, парковка, интернет",
        text:   "Современные офисы в Селятино. Инфраструктура бизнес-парка. Смотрите план этажа.",
        href:   utm("/rental", "offices_b"),
      },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log("\n🚀  Настройка кампаний Яндекс.Директ\n");

  // Получаем логин автоматически
  console.log("🔑  Авторизация...");
  const login = await getClientLogin();
  console.log(`     Аккаунт: ${login}\n`);

  // Проверяем существующие кампании (идемпотентность)
  const existing = await getExistingCampaignNames(login);
  console.log(`📋  Существующих кампаний: ${existing.size}\n`);

  for (const { campaign, group, keywords, ads } of CAMPAIGNS) {
    console.log(`━━━  ${campaign.name}`);

    if (existing.has(campaign.name)) {
      console.log(`     ⏭️   Уже существует -пропускаем\n`);
      continue;
    }

    // 1. Кампания
    const campaignId = await createCampaign(login, campaign);
    console.log(`     ✅  Кампания создана: ID ${campaignId}`);

    // 2. Группа объявлений
    const adGroupId = await createAdGroup(login, { ...group, campaignId });
    console.log(`     ✅  Группа создана:   ID ${adGroupId}`);

    // 3. Ключевые слова
    await addKeywords(login, adGroupId, keywords);
    console.log(`     ✅  Ключей добавлено: ${keywords.length}`);

    // 4. Объявления
    await addAds(login, adGroupId, ads);
    console.log(`     ✅  Объявлений:       ${ads.length} (A/B)\n`);
  }

  console.log("✨  Готово! Кампании созданы и ждут модерации Яндекса (~2-4 часа).");
  console.log("   Проверь: https://direct.yandex.ru\n");
}

main().catch((err) => {
  console.error(`\n❌  ${(err as Error).message}\n`);
  process.exit(1);
});
