import { MetrikaClient } from "../src/modules/analytics/metrika-client";

const token = process.env.YANDEX_OAUTH_TOKEN!;
const counterId = process.env.YANDEX_METRIKA_COUNTER_ID || "73068007";

async function fetchGoalsBatched(c: MetrikaClient, from: string, to: string) {
  const goals = await c.getGoals();
  const out: Array<{ id: number; name: string; type: string; reaches: number; cr: number }> = [];
  for (let i = 0; i < goals.length; i += 8) {
    const chunk = goals.slice(i, i + 8);
    const metrics = chunk.flatMap((g) => [
      `ym:s:goal${g.id}reaches`,
      `ym:s:goal${g.id}conversionRate`,
    ]);
    const url = `https://api-metrika.yandex.net/stat/v1/data?ids=${counterId}&metrics=${metrics.join(",")}&date1=${from}&date2=${to}`;
    const res = await fetch(url, { headers: { Authorization: `OAuth ${token}` } });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const json = (await res.json()) as { totals: number[] };
    chunk.forEach((g, idx) => {
      out.push({
        id: g.id,
        name: g.name,
        type: g.type,
        reaches: Math.round(json.totals[idx * 2] ?? 0),
        cr: Math.round((json.totals[idx * 2 + 1] ?? 0) * 100) / 100,
      });
    });
  }
  return out;
}

async function report(label: string, from: string, to: string) {
  const c = new MetrikaClient(token, counterId);
  console.log(`\n=== ${label} (${from} → ${to}) ===`);
  const traf = await c.getTrafficSummary(from, to);
  console.log(`Визиты: ${traf.visits} | Просмотры: ${traf.pageviews} | Юзеры: ${traf.users} | Отказы: ${traf.bounceRate}% | Время: ${traf.avgVisitDuration}s`);

  const sources = await c.getTrafficSources(from, to);
  console.log("Источники:");
  sources.forEach((s) => console.log(`  ${s.source.padEnd(28)} ${String(s.visits).padStart(4)} (${s.percentage}%)`));

  const goals = await fetchGoalsBatched(c, from, to);
  console.log(`Цели (всего ${goals.length}):`);
  goals
    .filter((g) => g.reaches > 0)
    .sort((a, b) => b.reaches - a.reaches)
    .forEach((g) => console.log(`  [${g.id}] ${g.name.padEnd(40)} ${g.type.padEnd(10)} reaches=${g.reaches}  CR=${g.cr}%`));
  const zeros = goals.filter((g) => g.reaches === 0);
  if (zeros.length) {
    console.log(`  (${zeros.length} с 0: ${zeros.map((g) => g.name).join(", ")})`);
  }

  try {
    const ad = await c.getAdSourceMetrics(from, to);
    console.log(`Я.Директ: ${ad.visits} визитов`);
    for (const [k, v] of ad.goalReaches) if (v > 0) {
      const g = goals.find((x) => x.id === k);
      console.log(`  goal ${k} (${g?.name}): ${v}`);
    }
  } catch (e) {
    console.log(`(ad metrics skipped: ${(e as Error).message.slice(0, 80)})`);
  }
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  await report("Last 7 days", d7, today);
  await report("Last 30 days", d30, today);
  await report("Since launch", "2026-04-14", today);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
