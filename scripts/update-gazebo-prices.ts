/**
 * Обновляет вместимость, описание и базовую цену беседок (Прайс-лист от 28.04.2026).
 *
 * Полная матрица (час/день × Пн-Чт/Пт-Вс) хранится в metadata.priceList,
 * чтобы публичная страница могла показать честный прайс. В колонку
 * `pricePerHour` пишется минимальная (будний час) — её используем как
 * "от X ₽/час" в карточках и калькуляторе.
 *
 * Запуск: node --env-file=.env --import tsx/esm scripts/update-gazebo-prices.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Pricing = {
  weekdayHour: number;
  weekdayDay: number;
  weekendHour: number;
  weekendDay: number;
};

const GAZEBOS: Array<{
  name: string;
  description: string;
  capacity: number;
  pricing: Pricing;
  features?: string[];
}> = [
  {
    name: "Беседка №1",
    description: "Большая беседка с отоплением, до 20 человек",
    capacity: 20,
    pricing: { weekdayHour: 1100, weekdayDay: 11000, weekendHour: 1400, weekendDay: 14000 },
  },
  {
    name: "Беседка №2",
    description: "Беседка с отоплением, до 12 человек",
    capacity: 12,
    pricing: { weekdayHour: 800, weekdayDay: 7000, weekendHour: 1000, weekendDay: 10000 },
  },
  {
    name: "Беседка №3",
    description: "Беседка с отоплением, до 12 человек",
    capacity: 12,
    pricing: { weekdayHour: 800, weekdayDay: 7000, weekendHour: 1000, weekendDay: 10000 },
  },
  {
    name: "Беседка №4",
    description: "Беседка с отоплением, до 12 человек",
    capacity: 12,
    pricing: { weekdayHour: 800, weekdayDay: 7000, weekendHour: 1000, weekendDay: 10000 },
  },
  {
    name: "Беседка №5",
    description: "Большая беседка с отоплением, интернетом и ТВ, до 30 человек",
    capacity: 30,
    pricing: { weekdayHour: 1400, weekdayDay: 13000, weekendHour: 1900, weekendDay: 16000 },
    features: ["интернет", "ТВ"],
  },
];

async function main() {
  console.log("→ Обновляю прайс беседок (с 28.04.2026)…\n");

  for (const g of GAZEBOS) {
    const existing = await prisma.resource.findFirst({
      where: { moduleSlug: "gazebos", name: g.name },
    });
    if (!existing) {
      console.warn(`  ⚠ ${g.name} не найдена в БД, пропускаю`);
      continue;
    }

    const metadata = {
      ...((existing.metadata as Record<string, unknown> | null) ?? {}),
      priceList: g.pricing,
      priceListUpdatedAt: "2026-04-28",
      workingHours: { from: "11:00", to: "22:30" },
      features: g.features ?? [],
    };

    await prisma.resource.update({
      where: { id: existing.id },
      data: {
        capacity: g.capacity,
        description: g.description,
        pricePerHour: g.pricing.weekdayHour,
        metadata,
      },
    });
    console.log(
      `  ✓ ${g.name}: до ${g.capacity} чел., от ${g.pricing.weekdayHour} ₽/час (Пт-Вс ${g.pricing.weekendHour}/час, день ${g.pricing.weekdayDay}-${g.pricing.weekendDay})`
    );
  }

  console.log("\n✅ Готово");
}

main()
  .catch((e) => {
    console.error(`\n❌ ${(e as Error).message}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
