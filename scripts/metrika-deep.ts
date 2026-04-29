/**
 * Глубокий разбор Я.Метрики:
 *   1. Топ страниц входа (landingPage) с разбивкой по визитам и отказам
 *   2. URL хитов, на которых сработала каждая офисная цель (через filters)
 *   3. Платный трафик (lastTrafficSource=='ad') — по landingPage и goal
 *   4. Воронка офиса: посещения /rental → office_inquiry_submit → success
 */
const TOKEN = process.env.YANDEX_OAUTH_TOKEN!;
const COUNTER = process.env.YANDEX_METRIKA_COUNTER_ID || "73068007";
const STAT = "https://api-metrika.yandex.net/stat/v1/data";

const OFFICE_GOAL_IDS = {
  submit: 546518893, // office_inquiry_submit
  success: 546518894, // office_inquiry_success
};

async function api<T>(params: Record<string, string>): Promise<T> {
  const u = `${STAT}?${new URLSearchParams(params)}`;
  const r = await fetch(u, { headers: { Authorization: `OAuth ${TOKEN}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()) as T;
}

type Row = { metrics: number[]; dimensions?: Array<{ name: string }> };
type Resp = { data: Row[]; totals: number[] };

async function landingPages(from: string, to: string, label: string, filter?: string) {
  const params: Record<string, string> = {
    ids: COUNTER,
    metrics: "ym:s:visits,ym:s:bounceRate,ym:s:goal189276649reaches",
    dimensions: "ym:s:startURLPath",
    date1: from,
    date2: to,
    sort: "-ym:s:visits",
    limit: "20",
  };
  if (filter) params.filters = filter;
  const data = await api<Resp>(params);
  console.log(`\n  ${label}:`);
  data.data.forEach((row) => {
    const url = row.dimensions?.[0]?.name || "?";
    const [v, br, fr] = row.metrics;
    console.log(`    ${url.padEnd(40)} visits=${String(v).padStart(4)}  bounce=${(br ?? 0).toFixed(1)}%  forms=${fr ?? 0}`);
  });
}

async function pagesForGoal(from: string, to: string, goalId: number, label: string) {
  // через goal_id Метрика возвращает достижения целей с разрезом по URL хита
  const data = await api<Resp>({
    ids: COUNTER,
    metrics: `ym:s:goal${goalId}reaches,ym:s:visits`,
    dimensions: "ym:s:startURLPath",
    date1: from,
    date2: to,
    filters: `ym:s:goal${goalId}reaches > 0`,
    sort: `-ym:s:goal${goalId}reaches`,
    limit: "20",
  });
  console.log(`\n  ${label}:`);
  if (!data.data.length) {
    console.log(`    (нет конверсий)`);
    return;
  }
  data.data.forEach((row) => {
    const url = row.dimensions?.[0]?.name || "?";
    const [g, v] = row.metrics;
    console.log(`    ${url.padEnd(40)} reaches=${g}  visits=${v}  CR=${v ? ((g / v) * 100).toFixed(2) : 0}%`);
  });
}

async function trafficByLandingPaid(from: string, to: string) {
  const data = await api<Resp>({
    ids: COUNTER,
    metrics: "ym:s:visits,ym:s:bounceRate",
    dimensions: "ym:s:startURLPath",
    filters: "ym:s:lastTrafficSource=='ad'",
    date1: from,
    date2: to,
    sort: "-ym:s:visits",
    limit: "20",
  });
  console.log(`\n  Платный трафик (ad) — landing pages:`);
  data.data.forEach((row) => {
    const url = row.dimensions?.[0]?.name || "?";
    const [v, br] = row.metrics;
    console.log(`    ${url.padEnd(40)} visits=${String(v).padStart(4)}  bounce=${(br ?? 0).toFixed(1)}%`);
  });
}

async function rentalFunnel(from: string, to: string) {
  const data = await api<Resp>({
    ids: COUNTER,
    metrics: `ym:s:visits,ym:s:goal${OFFICE_GOAL_IDS.submit}reaches,ym:s:goal${OFFICE_GOAL_IDS.success}reaches`,
    dimensions: "ym:s:startURLPath",
    filters: "ym:s:startURLPath=~'rental'",
    date1: from,
    date2: to,
    sort: "-ym:s:visits",
    limit: "20",
  });
  console.log(`\n  Воронка /rental*:`);
  let totVisits = 0, totSubmit = 0, totSuccess = 0;
  data.data.forEach((row) => {
    const url = row.dimensions?.[0]?.name || "?";
    const [v, s, ok] = row.metrics;
    totVisits += v; totSubmit += s; totSuccess += ok;
    console.log(`    ${url.padEnd(40)} visits=${v}  submit=${s}  success=${ok}`);
  });
  console.log(`    ─ ИТОГО: visits=${totVisits} → submit=${totSubmit} (${totVisits ? ((totSubmit/totVisits)*100).toFixed(2) : 0}%) → success=${totSuccess}`);
}

async function paidGoalAttribution(from: string, to: string) {
  // Достижения офисных целей в разрезе lastTrafficSource
  const data = await api<Resp>({
    ids: COUNTER,
    metrics: `ym:s:visits,ym:s:goal${OFFICE_GOAL_IDS.submit}reaches,ym:s:goal${OFFICE_GOAL_IDS.success}reaches`,
    dimensions: "ym:s:lastTrafficSource",
    date1: from,
    date2: to,
    sort: "-ym:s:visits",
  });
  console.log(`\n  Атрибуция офисных целей по источникам:`);
  data.data.forEach((row) => {
    const src = row.dimensions?.[0]?.name || "?";
    const [v, s, ok] = row.metrics;
    console.log(`    ${src.padEnd(28)} visits=${String(v).padStart(4)}  office_submit=${s}  office_success=${ok}`);
  });
}

async function block(label: string, from: string, to: string) {
  console.log(`\n=================== ${label}  (${from} → ${to}) ===================`);
  await landingPages(from, to, "Топ страниц входа (общий трафик)");
  await trafficByLandingPaid(from, to);
  await pagesForGoal(from, to, OFFICE_GOAL_IDS.submit, "URL, на которых сработала цель «Офис — отправка заявки»");
  await pagesForGoal(from, to, OFFICE_GOAL_IDS.success, "URL, на которых сработала цель «Офис — заявка принята»");
  await rentalFunnel(from, to);
  await paidGoalAttribution(from, to);
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  await block("Last 30 days", d30, today);
  await block("Last 7 days", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), today);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
