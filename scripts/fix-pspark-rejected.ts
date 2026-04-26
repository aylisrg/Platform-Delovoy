/**
 * Пересоздаёт 7 отклонённых объявлений PS Park без упоминания
 * товарных знаков PlayStation / PS5 / FIFA (Sony + EA — отклоняются модерацией).
 *
 * Замены:
 *   PlayStation / PS5  →  игровые консоли, приставки, игровая зона
 *   FIFA              →  футбольные симуляторы, спортивные игры
 *   Плей Парк         →  оставляем (наш бренд, не чужой)
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

const REJECTED_IDS = [17694510625, 17694510626, 17694510627, 17694510628, 17694510630, 17694510631, 17694510632];

// ═══ НОВЫЕ ОБЪЯВЛЕНИЯ PS Park — без товарных знаков ═══
const NEW_ADS: Array<{ groupId: number; title: string; title2: string; text: string; href: string }> = [
  // ─── Группа: PS Park — аренда (горячие) [5743244782] ───
  {
    groupId: 5743244782,
    title:  "Плей Парк — игровая аренда",
    title2: "Приставки, большие экраны",
    text:   "4 стола с консолями, мониторы до 65. Аренда от 1 часа. Селятино, Деловой.",
    href:   utm("/ps-park", "pspark_hot", "ps_a_v2"),
  },
  {
    groupId: 5743244782,
    title:  "Игровая аренда по часам",
    title2: "Экраны 55-65, от 800 руб",
    text:   "Консоли, геймпады, большие экраны. Для компании до 6 чел. Плей Парк, Селятино.",
    href:   utm("/ps-park", "pspark_hot", "ps_b_v2"),
  },
  // ─── Группа: PS Park — клуб [5743244787] ───
  {
    groupId: 5743244787,
    title:  "Плей Парк — игровая зона",
    title2: "Консоли, от 800 руб/час",
    text:   "Игровой клуб в Селятино. 4 стола, мониторы до 65. Онлайн-бронирование.",
    href:   utm("/ps-park", "pspark_club", "club_a_v2"),
  },
  {
    groupId: 5743244787,
    title:  "Игровой клуб в Селятино",
    title2: "4 стола, большие экраны",
    text:   "Плей Парк — игровая зона с консолями. Спортивные и гоночные игры. От 1 часа.",
    href:   utm("/ps-park", "pspark_club", "club_b_v2"),
  },
  // ─── Группа: PS Park — дети [5743244794] ───
  {
    groupId: 5743244794,
    title:  "Игровая зона для детей",
    title2: "от 1 часа, бронь онлайн",
    text:   "Плей Парк — игровая зона для детей от 6 лет. Спорт, гонки. Селятино.",
    href:   utm("/ps-park", "pspark_kids", "kids_a_v2"),
  },
  // ─── Группа: PS Park — гео [5743244798] ───
  {
    groupId: 5743244798,
    title:  "Плей Парк — Селятино",
    title2: "Игровая зона, бронь онлайн",
    text:   "Аренда приставок по часам в Селятино. 4 стола, мониторы до 65. Деловой.",
    href:   utm("/ps-park", "pspark_geo", "geo_a_v2"),
  },
  {
    groupId: 5743244798,
    title:  "Игровой клуб в Селятино",
    title2: "Консоли, большие экраны",
    text:   "Игровая зона рядом с Нарофоминском. 4 стола, до 6 геймпадов. От 800 руб/час.",
    href:   utm("/ps-park", "pspark_geo", "geo_b_v2"),
  },
];

async function main() {
  // Валидация лимитов
  for (const a of NEW_ADS) {
    if (a.title.length > 35)  throw new Error(`Title >35: "${a.title}" (${a.title.length})`);
    if (a.title2.length > 30) throw new Error(`Title2 >30: "${a.title2}" (${a.title2.length})`);
    if (a.text.length > 81)   throw new Error(`Text >81: "${a.text}" (${a.text.length})`);
  }
  console.log("✓ Все длины в лимитах\n");

  // 1. Архивируем/удаляем отклонённые (их нельзя переподать — только новые)
  console.log(`Удаляю ${REJECTED_IDS.length} отклонённых объявлений...`);
  const delResult = await req<{ DeleteResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "ads", "delete",
    { SelectionCriteria: { Ids: REJECTED_IDS } }
  );
  let deleted = 0;
  for (const r of delResult.DeleteResults) {
    if (r.Id) deleted++;
    else console.error(`  ✗ ${r.Errors?.[0]?.Message}`);
  }
  console.log(`✓ Удалено: ${deleted}\n`);

  // 2. Создаём новые
  console.log(`Создаю ${NEW_ADS.length} новых объявлений...`);
  const adsPayload = NEW_ADS.map((a) => ({
    AdGroupId: a.groupId,
    TextAd: {
      Title:  a.title,
      Title2: a.title2,
      Text:   a.text,
      Href:   a.href,
      Mobile: "NO",
    },
  }));

  const addResult = await req<{ AddResults: Array<{ Id?: number; Errors?: Array<{ Message: string; Details?: string }> }> }>(
    "ads", "add",
    { Ads: adsPayload }
  );

  const createdIds: number[] = [];
  for (let i = 0; i < addResult.AddResults.length; i++) {
    const r = addResult.AddResults[i];
    if (r.Id) {
      createdIds.push(r.Id);
    } else {
      console.error(`  ✗ "${NEW_ADS[i].title}": ${r.Errors?.[0]?.Message} — ${r.Errors?.[0]?.Details}`);
    }
  }
  console.log(`✓ Создано: ${createdIds.length}\n`);

  if (createdIds.length === 0) {
    console.error("Нечего отправлять на модерацию");
    process.exit(1);
  }

  // 3. На модерацию
  console.log(`Отправляю ${createdIds.length} объявлений на модерацию...`);
  const modResult = await req<{ ModerateResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "ads", "moderate",
    { SelectionCriteria: { Ids: createdIds } }
  );
  let sent = 0;
  for (const r of modResult.ModerateResults) {
    if (r.Id) sent++;
  }
  console.log(`✓ Отправлено: ${sent}\n`);

  console.log("✅ Готово! Новые объявления на модерации.");
  console.log(`   IDs: ${createdIds.join(", ")}`);
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}\n`);
  process.exit(1);
});
