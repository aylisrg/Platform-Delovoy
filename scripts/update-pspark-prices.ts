/**
 * Чистит и обновляет рекламу Плей Парк в Директе:
 *   1. Удаляет 7 REJECTED-объявлений со старыми текстами (PS5/FIFA)
 *   2. Останавливает 4 ACCEPTED-объявления, где цена указана как "от 800 руб"
 *      (статистика сохраняется, но трафик идёт только на свежие)
 *   3. Создаёт 8 новых объявлений с правильной ценой "от 300 ₽/час"
 *   4. Отправляет новые на модерацию
 *   5. Добавляет минус-фразы в группу "дети" — режет нерелевантный трафик
 *
 * Запуск: node --env-file=.env --import tsx/esm scripts/update-pspark-prices.ts
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

// ═══ 1. REJECTED — удалить ═══
const REJECTED_IDS = [17694510625, 17694510626, 17694510627, 17694510628, 17694510630, 17694510631, 17694510632];

// ═══ 2. ACCEPTED с "800 руб" — приостановить (suspend, не удаляем — сохраняем историю) ═══
const SUSPEND_IDS = [
  17694735517, // горячие T2 "от 800 руб"
  17694741128, // горячие Text "От 800 руб/час"
  17694735520, // клуб T2 "от 800 руб/час"
  17694735522, // гео Text "От 800 руб/час"
  // 17694510629 уже SUSPENDED
];

// ═══ 3. Новые объявления — цена 300 ₽/час везде ═══
const GROUPS = {
  HOT:   5743244782, // горячие
  CLUB:  5743244787, // игровой клуб / зона
  KIDS:  5743244794, // дети и подростки
  GEO:   5743244798, // гео (Селятино, Нарофоминск)
};

const NEW_ADS: Array<{ groupId: number; title: string; title2: string; text: string; href: string }> = [
  // ─── Горячие (1) ───
  {
    groupId: GROUPS.HOT,
    title:  "Аренда консолей — 300 ₽/час",
    title2: "Большие экраны 55-65″",
    text:   "Плей Парк: приставки, геймпады, мониторы. Селятино, Деловой Парк. Бронь онлайн.",
    href:   utm("/ps-park", "pspark_hot", "ps_300_a"),
  },
  {
    groupId: GROUPS.HOT,
    title:  "Игровая по часам — 300 ₽",
    title2: "Приставки, до 6 геймпадов",
    text:   "Плей Парк в Селятино: 4 стола с консолями, экраны 55-65″. От 1 часа.",
    href:   utm("/ps-park", "pspark_hot", "ps_300_b"),
  },
  // ─── Клуб (2) ───
  {
    groupId: GROUPS.CLUB,
    title:  "Игровой клуб — 300 ₽/час",
    title2: "Консоли, большие экраны",
    text:   "Плей Парк: 4 стола с приставками, мониторы 55-65″. Бронь онлайн. Селятино.",
    href:   utm("/ps-park", "pspark_club", "club_300_a"),
  },
  {
    groupId: GROUPS.CLUB,
    title:  "Игровая зона в Селятино",
    title2: "Приставки, от 300 ₽/час",
    text:   "Плей Парк — игровой клуб: 4 стола, экраны 55-65″, спорт и гонки. От 1 часа.",
    href:   utm("/ps-park", "pspark_club", "club_300_b"),
  },
  // ─── Дети (2) ───
  {
    groupId: GROUPS.KIDS,
    title:  "Куда сводить подростка?",
    title2: "Игровой клуб, 300 ₽/час",
    text:   "Плей Парк: приставки, спорт, гонки, приключения. От 6 лет. Селятино.",
    href:   utm("/ps-park", "pspark_kids", "kids_300_a"),
  },
  {
    groupId: GROUPS.KIDS,
    title:  "Игровой клуб для подростков",
    title2: "Консоли, 300 ₽/час",
    text:   "Плей Парк в Селятино: 4 стола, большие экраны. От 6 лет. Бронь онлайн.",
    href:   utm("/ps-park", "pspark_kids", "kids_300_b"),
  },
  // ─── Гео (2) ───
  {
    groupId: GROUPS.GEO,
    title:  "Игровой клуб Нарофоминск",
    title2: "Приставки, 300 ₽/час",
    text:   "Плей Парк в Селятино: 4 стола, до 6 геймпадов, экраны 55-65″. Бронь онлайн.",
    href:   utm("/ps-park", "pspark_geo", "geo_300_a"),
  },
  {
    groupId: GROUPS.GEO,
    title:  "Аренда консолей в Селятино",
    title2: "от 300 ₽/час, бронь онлайн",
    text:   "Плей Парк, Деловой Парк: приставки, мониторы 55-65″. Рядом с Нарофоминском.",
    href:   utm("/ps-park", "pspark_geo", "geo_300_b"),
  },
];

// ═══ 4. Минус-фразы для группы "дети" — режут нерелевантный трафик ═══
const KIDS_NEGATIVE_KEYWORDS = [
  "развлечения для детей",
  "детская игровая комната",
  "чем занять ребенка",
  "детский центр",
  "детский сад",
  "развивающие занятия",
  "детский праздник",
  "аниматор",
];

async function main() {
  // Валидация длин
  for (const a of NEW_ADS) {
    if (a.title.length > 35)  throw new Error(`Title >35: "${a.title}" (${a.title.length})`);
    if (a.title2.length > 30) throw new Error(`Title2 >30: "${a.title2}" (${a.title2.length})`);
    if (a.text.length > 81)   throw new Error(`Text >81: "${a.text}" (${a.text.length})`);
  }
  console.log("✓ Все длины в лимитах\n");

  // ─── 1. Удаляем REJECTED ───
  console.log(`→ Удаляю ${REJECTED_IDS.length} REJECTED-объявлений…`);
  const delResult = await req<{ DeleteResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "ads", "delete",
    { SelectionCriteria: { Ids: REJECTED_IDS } }
  );
  let deleted = 0;
  for (const r of delResult.DeleteResults) {
    if (r.Id) deleted++;
    else console.error(`  ✗ ${r.Errors?.[0]?.Message}`);
  }
  console.log(`  ✓ Удалено: ${deleted}/${REJECTED_IDS.length}\n`);

  // ─── 2. Останавливаем объявления с ценой 800 ───
  console.log(`→ Останавливаю ${SUSPEND_IDS.length} объявлений с ценой "800 руб"…`);
  const suspendResult = await req<{ SuspendResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "ads", "suspend",
    { SelectionCriteria: { Ids: SUSPEND_IDS } }
  );
  let suspended = 0;
  for (const r of suspendResult.SuspendResults) {
    if (r.Id) suspended++;
    else console.error(`  ✗ ${r.Errors?.[0]?.Message}`);
  }
  console.log(`  ✓ Остановлено: ${suspended}/${SUSPEND_IDS.length}\n`);

  // ─── 3. Создаём новые ───
  console.log(`→ Создаю ${NEW_ADS.length} новых объявлений с ценой 300 ₽/час…`);
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
  console.log(`  Создано: ${createdIds.length}/${NEW_ADS.length}\n`);

  // ─── 4. Отправляем на модерацию ───
  if (createdIds.length) {
    console.log(`→ Отправляю ${createdIds.length} на модерацию…`);
    const modResult = await req<{ ModerateResults: Array<{ Id?: number }> }>(
      "ads", "moderate",
      { SelectionCriteria: { Ids: createdIds } }
    );
    const sent = modResult.ModerateResults.filter((r) => r.Id).length;
    console.log(`  ✓ Отправлено: ${sent}\n`);
  }

  // ─── 5. Добавляем минус-фразы в группу "дети" ───
  console.log(`→ Добавляю ${KIDS_NEGATIVE_KEYWORDS.length} минус-фраз в группу "дети"…`);
  const negResult = await req<{ UpdateResults: Array<{ Id?: number; Errors?: Array<{ Message: string }> }> }>(
    "adgroups", "update",
    {
      AdGroups: [{
        Id: GROUPS.KIDS,
        NegativeKeywords: { Items: KIDS_NEGATIVE_KEYWORDS },
      }],
    }
  );
  for (const r of negResult.UpdateResults) {
    if (r.Id) console.log(`  ✓ Минус-фразы добавлены в группу ${r.Id}`);
    else console.error(`  ✗ ${r.Errors?.[0]?.Message}`);
  }

  console.log("\n✅ Готово!");
  console.log(`   Удалено: ${deleted} • Остановлено: ${suspended} • Создано: ${createdIds.length}`);
  console.log(`   Минус-фраз: ${KIDS_NEGATIVE_KEYWORDS.length}`);
  console.log(`   Новые IDs: ${createdIds.join(", ")}`);
}

main().catch((e) => {
  console.error(`\n❌ ${(e as Error).message}\n`);
  process.exit(1);
});
