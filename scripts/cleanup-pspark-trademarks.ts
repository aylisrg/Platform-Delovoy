/**
 * Окончательная очистка PS Park от товарных знаков PlayStation / PS5 / FIFA:
 *   1. Останавливает ACCEPTED объявление с TM (Яндекс пропустил по ошибке)
 *   2. Добавляет новые сильные объявления для A/B без упоминания брендов
 *   3. Переименовывает группы и кампанию (убирает PS5 из служебных имён)
 *
 * Копирайтинг-словарь без товарных знаков:
 *   - приставки / игровые консоли / современные консоли
 *   - игровая зона / игровой клуб / игровая комната
 *   - футбольные симуляторы / гоночные симуляторы / шутеры / приключения
 *   - Плей Парк — собственный бренд, остаётся
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

// ═══ 1. Объявление с товарным знаком — остановить ═══
const TM_AD_TO_SUSPEND = 17694510629; // "PlayStation 5, экраны" / "PS5, 4 стола"

// ═══ 2. Новые сильные копии без товарных знаков ═══
// По одному дополнительному в каждую группу, чтобы A/B стало полноценным.
const NEW_ADS: Array<{ groupId: number; title: string; title2: string; text: string; href: string }> = [
  // Группа "горячие" — ещё один эмоциональный вариант
  {
    groupId: 5743244782,
    title:  "Играй с друзьями на большом",
    title2: "Аренда консолей по часам",
    text:   "Плей Парк: игровые приставки, геймпады, экраны 55-65. От 800 руб/час. Селятино.",
    href:   utm("/ps-park", "pspark_hot", "ps_c"),
  },
  // Группа "клуб" — эмоциональный триггер
  {
    groupId: 5743244787,
    title:  "Игровой клуб в Селятино",
    title2: "Футбол, гонки, шутеры",
    text:   "Плей Парк — современные консоли, 4 стола, большие экраны. Бронь онлайн.",
    href:   utm("/ps-park", "pspark_club", "club_c"),
  },
  // Группа "дети" — замена TM-объявлению, сильный CTA для родителей
  {
    groupId: 5743244794,
    title:  "Куда сводить ребёнка?",
    title2: "В игровой клуб — играть!",
    text:   "Плей Парк: игровая зона для детей от 6 лет. Приставки, большие экраны. Селятино.",
    href:   utm("/ps-park", "pspark_kids", "kids_c"),
  },
  // Группа "гео" — акцент на Нарофоминск
  {
    groupId: 5743244798,
    title:  "Игровой клуб Нарофоминск",
    title2: "Приставки, большие экраны",
    text:   "Плей Парк в Селятино — 4 стола с консолями. До 6 геймпадов. От 800 руб/час.",
    href:   utm("/ps-park", "pspark_geo", "geo_c"),
  },
];

// ═══ 3. Переименование групп и кампании — убрать PS5 из служебных имён ═══
const GROUP_RENAMES: Array<{ id: number; name: string }> = [
  { id: 5743244782, name: "Плей Парк — аренда (горячие)" },
  { id: 5743244787, name: "Плей Парк — игровой клуб / зона" },
  { id: 5743244794, name: "Плей Парк — дети и подростки" },
  { id: 5743244798, name: "Плей Парк — гео (Селятино, Нарофоминск)" },
];

const CAMPAIGN_RENAME = { id: 709135118, name: "Деловой — Плей Парк (Поиск)" };

async function main() {
  // Валидация длин
  for (const a of NEW_ADS) {
    if (a.title.length > 35)  throw new Error(`Title >35: "${a.title}" (${a.title.length})`);
    if (a.title2.length > 30) throw new Error(`Title2 >30: "${a.title2}" (${a.title2.length})`);
    if (a.text.length > 81)   throw new Error(`Text >81: "${a.text}" (${a.text.length})`);
  }
  console.log("✓ Длины всех новых объявлений в лимитах\n");

  // ─── Шаг 1: Остановить TM-объявление ───
  console.log(`→ Останавливаю TM-объявление ${TM_AD_TO_SUSPEND}...`);
  const suspendResult = await req<{ SuspendResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "ads", "suspend",
    { SelectionCriteria: { Ids: [TM_AD_TO_SUSPEND] } }
  );
  for (const r of suspendResult.SuspendResults) {
    if (r.Id) console.log(`  ✓ Остановлено: ${r.Id}`);
    else console.error(`  ✗ ${r.Errors?.[0]?.Message}`);
  }

  // ─── Шаг 2: Создать новые объявления ───
  console.log(`\n→ Создаю ${NEW_ADS.length} новых объявлений без товарных знаков...`);
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
      console.log(`  ✓ ${r.Id}: ${NEW_ADS[i].title}`);
    } else {
      console.error(`  ✗ "${NEW_ADS[i].title}": ${r.Errors?.[0]?.Message} — ${r.Errors?.[0]?.Details}`);
    }
  }

  // ─── Шаг 3: Отправить новые на модерацию ───
  if (createdIds.length) {
    console.log(`\n→ Отправляю ${createdIds.length} на модерацию...`);
    const modResult = await req<{ ModerateResults: Array<{ Id?: number }> }>(
      "ads", "moderate",
      { SelectionCriteria: { Ids: createdIds } }
    );
    const sent = modResult.ModerateResults.filter((r) => r.Id).length;
    console.log(`  ✓ Отправлено: ${sent}`);
  }

  // ─── Шаг 4: Переименовать группы ───
  console.log(`\n→ Переименовываю группы (убираю PS5 из имён)...`);
  const renameResult = await req<{ UpdateResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "adgroups", "update",
    {
      AdGroups: GROUP_RENAMES.map((g) => ({ Id: g.id, Name: g.name })),
    }
  );
  for (let i = 0; i < renameResult.UpdateResults.length; i++) {
    const r = renameResult.UpdateResults[i];
    if (r.Id) console.log(`  ✓ ${r.Id}: ${GROUP_RENAMES[i].name}`);
    else console.error(`  ✗ ${GROUP_RENAMES[i].name}: ${r.Errors?.[0]?.Message}`);
  }

  // ─── Шаг 5: Переименовать кампанию ───
  console.log(`\n→ Переименовываю кампанию...`);
  const campRenameResult = await req<{ UpdateResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "campaigns", "update",
    {
      Campaigns: [{ Id: CAMPAIGN_RENAME.id, Name: CAMPAIGN_RENAME.name }],
    }
  );
  for (const r of campRenameResult.UpdateResults) {
    if (r.Id) console.log(`  ✓ ${r.Id}: ${CAMPAIGN_RENAME.name}`);
    else console.error(`  ✗ ${r.Errors?.[0]?.Message}`);
  }

  console.log("\n✅ Готово!");
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}\n`);
  process.exit(1);
});
