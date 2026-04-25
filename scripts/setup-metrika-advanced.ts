/**
 * Продвинутая настройка Яндекс.Метрики:
 *  - фильтр внутреннего трафика (IP определяется автоматически)
 *  - ретаргетинговые сегменты для Директа
 *
 * Запуск: npm run setup:metrika-advanced
 */

const COUNTER_ID = process.env.YANDEX_METRIKA_COUNTER_ID || "73068007";
const API_BASE = `https://api-metrika.yandex.net/management/v1/counter/${COUNTER_ID}`;
const token = process.env.YANDEX_OAUTH_TOKEN;

if (!token) {
  console.error("❌  Не задан YANDEX_OAUTH_TOKEN в .env");
  process.exit(1);
}

async function metrikaRequest<T>(path: string, method = "GET", body?: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `OAuth ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json() as { errors?: Array<{ message: string }> } & T;
  if (!res.ok) throw new Error(`Metrika API ${path}: ${JSON.stringify((data as { errors?: unknown }).errors)}`);
  return data;
}

// ─── 1. Получить публичный IP машины ──────────────────────────────

async function getPublicIP(): Promise<string> {
  const res = await fetch("https://api.ipify.org?format=json");
  const data = await res.json() as { ip: string };
  return data.ip;
}

// ─── 2. IP-фильтр ─────────────────────────────────────────────────

async function getExistingFilters(): Promise<Array<{ id: number; value: string }>> {
  const data = await metrikaRequest<{ filters: Array<{ id: number; attr: string; value: string }> }>("/filters");
  return (data.filters ?? []).map((f) => ({ id: f.id, value: f.value }));
}

async function addIPFilter(ip: string): Promise<void> {
  await metrikaRequest("/filters", "POST", {
    filter: {
      attr: "uniq_id",
      type: "equal",
      value: ip,
      action: "exclude",
      status: "active",
    },
  });
}

// ─── 3. Сегменты ──────────────────────────────────────────────────

async function getExistingSegments(): Promise<string[]> {
  const data = await metrikaRequest<{ segments: Array<{ name: string }> }>("/segments");
  return (data.segments ?? []).map((s) => s.name);
}

async function createSegment(name: string, expression: string): Promise<void> {
  await metrikaRequest("/segments", "POST", {
    segment: { name, expression },
  });
}

const SEGMENTS = [
  {
    name: "Беседки — интерес без бронирования",
    expression: "ym:s:pageviewsPerVisit>1 AND ym:s:parsedURL.pathname=='/' AND ym:s:goal123==0",
    description: "Был на /gazebos, не забронировал — самый горячий ретаргетинг",
    // expression через визиты на страницу
    pageExpression: "ym:pv:URLPath=='/gazebos'",
  },
  {
    name: "PS Park — интерес без бронирования",
    pageExpression: "ym:pv:URLPath=='/ps-park'",
    description: "Был на /ps-park, не забронировал",
  },
  {
    name: "Офисы — интерес без заявки",
    pageExpression: "ym:pv:URLPath=='/rental'",
    description: "Был на /rental, не оставил заявку",
  },
  {
    name: "Все конвертировавшиеся",
    pageExpression: "ym:s:goalsQuantity>0",
    description: "Совершили любое целевое действие — исключить из ретаргетинга",
  },
];

// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n⚙️   Продвинутая настройка Яндекс.Метрики (счётчик ${COUNTER_ID})\n`);

  // ── IP фильтр ───────────────────────────────────────────────────
  console.log("1️⃣   IP-фильтр внутреннего трафика...");
  const ip = await getPublicIP();
  console.log(`     Публичный IP этой машины: ${ip}`);

  const existingFilters = await getExistingFilters();
  const alreadyFiltered = existingFilters.some((f) => f.value === ip);

  if (alreadyFiltered) {
    console.log(`     ⏭️   IP уже в фильтрах — пропускаем`);
  } else {
    try {
      await addIPFilter(ip);
      console.log(`     ✅  IP ${ip} добавлен в исключения`);
    } catch {
      // Метрика иногда возвращает ошибку на attr=uniq_id, пробуем ip
      try {
        await metrikaRequest("/filters", "POST", {
          filter: { attr: "ip", type: "equal", value: ip, action: "exclude", status: "active" },
        });
        console.log(`     ✅  IP ${ip} добавлен в исключения`);
      } catch {
        console.warn(`     ⚠️   Не удалось добавить через API — добавь вручную в Метрике: ${ip}`);
        console.warn(`          Фильтры → Добавить фильтр → IP-адрес → ${ip}`);
      }
    }
  }

  // ── Сегменты ────────────────────────────────────────────────────
  console.log("\n2️⃣   Ретаргетинговые сегменты...");
  const existingSegmentNames = await getExistingSegments();

  for (const seg of SEGMENTS) {
    if (existingSegmentNames.includes(seg.name)) {
      console.log(`     ⏭️   Уже есть: "${seg.name}"`);
      continue;
    }
    try {
      const expression = seg.pageExpression ?? seg.expression;
      await createSegment(seg.name, expression);
      console.log(`     ✅  Создан: "${seg.name}"`);
    } catch {
      console.warn(`     ⚠️   Не удалось создать "${seg.name}" через API — создай вручную в Метрике`);
    }
  }

  console.log(`
✨  Готово!

Следующий шаг — привязать Метрику к Директу вручную:
   metrika.yandex.ru → счётчик ${COUNTER_ID} → Настройки → Доступ
   → Добавить пользователя → логин аккаунта Директа → Представление
`);
}

main().catch((err) => {
  console.error(`\n❌  ${(err as Error).message}\n`);
  process.exit(1);
});
