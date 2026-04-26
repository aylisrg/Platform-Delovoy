import { prisma } from "../src/lib/db";

async function main() {
  const since = new Date("2026-04-21");

  const byStatus = await prisma.booking.groupBy({
    by: ["status"],
    where: { moduleSlug: "ps-park", createdAt: { gte: since } },
    _count: { _all: true },
  });
  console.log("\n━━━ PS Park bookings с 2026-04-21 ━━━");
  console.log(byStatus.length ? byStatus : "(нет броней)");

  const total = await prisma.booking.count({
    where: { moduleSlug: "ps-park", createdAt: { gte: since } },
  });
  console.log(`Всего: ${total}`);

  // Метаданные — есть ли userId, или анонимные?
  const recent = await prisma.booking.findMany({
    where: { moduleSlug: "ps-park", createdAt: { gte: since } },
    select: { id: true, status: true, userId: true, createdAt: true, metadata: true },
    take: 20,
    orderBy: { createdAt: "desc" },
  });
  console.log("\n━━━ Последние ━━━");
  for (const b of recent) {
    console.log(`  ${b.createdAt.toISOString().slice(0, 16)}  ${b.status}  user=${b.userId.slice(0, 8)}…`);
  }

  // Сравнение: сколько броней беседок за тот же период (для контроля)
  const gazTotal = await prisma.booking.count({
    where: { moduleSlug: "gazebos", createdAt: { gte: since } },
  });
  console.log(`\nДля сравнения: беседок за тот же период — ${gazTotal}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
