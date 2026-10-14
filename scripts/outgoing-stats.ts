/**
 * Read-only диагностика «миллиона уведомлений» (#708, #917).
 * Только SELECT (findMany). Печатает агрегаты OutgoingNotification за сутки
 * по Дубаю: по часам × status/channel/eventType и дубли по dedupKey
 * (ключ только как sha256-хэш). Без payload, адресов, userId, имён.
 *
 * Usage (внутри app-контейнера):
 *   npx tsx scripts/outgoing-stats.ts                       # 2026-10-13
 *   npx tsx scripts/outgoing-stats.ts --date=2026-10-13 --top=20
 */
import { prisma } from "../src/lib/db";
import { aggregate, dubaiDayRange, formatStats, type StatsRow } from "./outgoing-stats-lib";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const BATCH = 5000;

async function* fetchRows(from: Date, to: Date): AsyncGenerator<StatsRow> {
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.outgoingNotification.findMany({
      where: { createdAt: { gte: from, lt: to } },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        status: true,
        eventType: true,
        dedupKey: true,
        createdAt: true,
        channel: { select: { kind: true } },
      },
    });
    for (const r of page) {
      yield {
        status: r.status,
        eventType: r.eventType,
        dedupKey: r.dedupKey,
        createdAt: r.createdAt,
        channelKind: r.channel?.kind ?? "UNKNOWN",
      };
    }
    if (page.length < BATCH) return;
    cursor = page[page.length - 1].id;
  }
}

async function main() {
  const date = arg("date") ?? "2026-10-13";
  const top = Math.min(Math.max(Number(arg("top") ?? 20) || 20, 1), 100);
  const { from, to } = dubaiDayRange(date);
  const rows: StatsRow[] = [];
  for await (const r of fetchRows(from, to)) rows.push(r);
  console.log(formatStats(aggregate(rows, date, top)));
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
