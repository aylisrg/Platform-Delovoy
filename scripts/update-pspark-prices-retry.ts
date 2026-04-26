/**
 * Доделка update-pspark-prices.ts:
 *   - архивирует 7 REJECTED (delete не работает для REJECTED)
 *   - пересоздаёт 6 объявлений без запрещённого символа ″
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

const GROUPS = {
  HOT:   5743244782,
  CLUB:  5743244787,
  GEO:   5743244798,
};

// Без символа ″ (запрещён) — используем "до 65" вместо "55-65″"
const NEW_ADS: Array<{ groupId: number; title: string; title2: string; text: string; href: string }> = [
  // Горячие
  {
    groupId: GROUPS.HOT,
    title:  "Аренда консолей - 300 ₽/час",
    title2: "Большие экраны до 65",
    text:   "Плей Парк: приставки, геймпады, мониторы. Селятино, Деловой Парк. Бронь онлайн.",
    href:   utm("/ps-park", "pspark_hot", "ps_300_a2"),
  },
  {
    groupId: GROUPS.HOT,
    title:  "Игровая по часам - 300 ₽",
    title2: "Приставки, до 6 геймпадов",
    text:   "Плей Парк в Селятино: 4 стола с консолями, экраны до 65. От 1 часа.",
    href:   utm("/ps-park", "pspark_hot", "ps_300_b2"),
  },
  // Клуб
  {
    groupId: GROUPS.CLUB,
    title:  "Игровой клуб - 300 ₽/час",
    title2: "Консоли, большие экраны",
    text:   "Плей Парк: 4 стола с приставками, мониторы до 65. Бронь онлайн. Селятино.",
    href:   utm("/ps-park", "pspark_club", "club_300_a2"),
  },
  {
    groupId: GROUPS.CLUB,
    title:  "Игровая зона в Селятино",
    title2: "Приставки, от 300 ₽/час",
    text:   "Плей Парк - игровой клуб: 4 стола, экраны до 65, спорт и гонки. От 1 часа.",
    href:   utm("/ps-park", "pspark_club", "club_300_b2"),
  },
  // Гео
  {
    groupId: GROUPS.GEO,
    title:  "Игровой клуб Нарофоминск",
    title2: "Приставки, 300 ₽/час",
    text:   "Плей Парк в Селятино: 4 стола, до 6 геймпадов, экраны до 65. Бронь онлайн.",
    href:   utm("/ps-park", "pspark_geo", "geo_300_a2"),
  },
  {
    groupId: GROUPS.GEO,
    title:  "Аренда консолей в Селятино",
    title2: "от 300 ₽/час, бронь онлайн",
    text:   "Плей Парк, Деловой Парк: приставки, мониторы до 65. Рядом с Нарофоминском.",
    href:   utm("/ps-park", "pspark_geo", "geo_300_b2"),
  },
];

async function main() {
  for (const a of NEW_ADS) {
    if (a.title.length > 35)  throw new Error(`Title >35: "${a.title}" (${a.title.length})`);
    if (a.title2.length > 30) throw new Error(`Title2 >30: "${a.title2}" (${a.title2.length})`);
    if (a.text.length > 81)   throw new Error(`Text >81: "${a.text}" (${a.text.length})`);
  }
  console.log("✓ Длины ОК\n");

  // ─── Архивируем REJECTED ───
  console.log(`→ Архивирую ${REJECTED_IDS.length} REJECTED…`);
  const archResult = await req<{ ArchiveResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "ads", "archive",
    { SelectionCriteria: { Ids: REJECTED_IDS } }
  );
  let archived = 0;
  for (const r of archResult.ArchiveResults) {
    if (r.Id) archived++;
    else console.error(`  ✗ ${r.Errors?.[0]?.Message}`);
  }
  console.log(`  ✓ Архивировано: ${archived}/${REJECTED_IDS.length}\n`);

  // ─── Создаём ───
  console.log(`→ Создаю ${NEW_ADS.length} объявлений (без символа ″)…`);
  const adsPayload = NEW_ADS.map((a) => ({
    AdGroupId: a.groupId,
    TextAd: { Title: a.title, Title2: a.title2, Text: a.text, Href: a.href, Mobile: "NO" },
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
      console.log(`  ✓ ${r.Id}: ${NEW_ADS[i].title}`);
    } else {
      console.error(`  ✗ "${NEW_ADS[i].title}": ${r.Errors?.[0]?.Message} — ${r.Errors?.[0]?.Details}`);
    }
  }

  // ─── На модерацию ───
  if (createdIds.length) {
    console.log(`\n→ На модерацию ${createdIds.length}…`);
    const modResult = await req<{ ModerateResults: Array<{ Id?: number }> }>(
      "ads", "moderate",
      { SelectionCriteria: { Ids: createdIds } }
    );
    console.log(`  ✓ Отправлено: ${modResult.ModerateResults.filter(r => r.Id).length}`);
  }

  console.log(`\n✅ Готово! Архивировано: ${archived} • Создано: ${createdIds.length}`);
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}\n`);
  process.exit(1);
});
