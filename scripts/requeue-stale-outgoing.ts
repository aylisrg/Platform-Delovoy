/**
 * Возвращает в очередь OutgoingNotification, которые processOutgoing пометил
 * SKIPPED как «старше 24 часов» после простоя крона (#917, #708): те самые
 * 19 сообщений, которые висели, пока middleware не пускал крон к роуту.
 *
 * По умолчанию DRY-RUN: только печатает, что было бы возвращено
 * (id, eventType, возраст). Payload и адреса не печатаются (там ПДн).
 * Запись только с флагом --apply.
 *
 * Идемпотентно: update идёт с условием status=SKIPPED и тем же failureReason,
 * поэтому повторный запуск ничего не находит (записи уже PENDING или SENT).
 *
 * Usage (внутри app-контейнера):
 *   npx tsx scripts/requeue-stale-outgoing.ts                      # dry-run
 *   npx tsx scripts/requeue-stale-outgoing.ts --since=2026-10-01 --limit=50
 *   npx tsx scripts/requeue-stale-outgoing.ts --event-types=A,B    # только эти типы
 *   npx tsx scripts/requeue-stale-outgoing.ts --apply
 */
import { prisma } from "../src/lib/db";
import { STALE_SKIP_REASON } from "../src/modules/notifications/dispatch/dispatcher";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const since = new Date(arg("since") ?? "2026-10-01T00:00:00Z");
  if (Number.isNaN(since.getTime())) throw new Error("--since: неверная дата");
  const limit = Math.min(Math.max(Number(arg("limit") ?? 50), 1), 500);
  const eventTypes = arg("event-types")?.split(",").map((s) => s.trim()).filter(Boolean);

  const where = {
    status: "SKIPPED" as const,
    failureReason: STALE_SKIP_REASON,
    createdAt: { gte: since },
    ...(eventTypes?.length ? { eventType: { in: eventTypes } } : {}),
  };
  const rows = await prisma.outgoingNotification.findMany({
    where,
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, eventType: true, createdAt: true, scheduledFor: true },
  });

  const now = Date.now();
  for (const r of rows) {
    const ageH = ((now - r.createdAt.getTime()) / 3_600_000).toFixed(1);
    console.log(`${r.id}\t${r.eventType}\tcreated ${r.createdAt.toISOString()} (${ageH}h ago)`);
  }

  let requeued = 0;
  if (apply) {
    for (const r of rows) {
      const res = await prisma.outgoingNotification.updateMany({
        where: { id: r.id, status: "SKIPPED", failureReason: STALE_SKIP_REASON },
        data: { status: "PENDING", scheduledFor: new Date(), attempts: 0, failureReason: null },
      });
      requeued += res.count;
    }
  }

  console.log(
    `\nFound ${rows.length} stale-skipped (since ${since.toISOString()}, limit ${limit}). ` +
      (apply ? `Requeued: ${requeued}. Крон process-outgoing отправит их в течение минуты.` : "DRY-RUN: ничего не записано, для записи добавьте --apply.")
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
