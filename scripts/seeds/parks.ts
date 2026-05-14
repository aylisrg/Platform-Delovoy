/**
 * Parks seed — создаёт записи бизнес-парков.
 *
 * Идемпотентность: upsert по slug. update-блок НЕ перезаписывает
 * isActive/config/contactPhone/contactEmail/legalAddress — эти поля
 * редактируются через UI, seed не должен их сбрасывать.
 */
import type { PrismaClient } from "@prisma/client";

export async function seedParks(prisma: PrismaClient): Promise<void> {
  const parks = [
    {
      slug: "delovoy",
      name: "Деловой",
      description: "Бизнес-парк Деловой (основной)",
    },
    {
      slug: "nedelovoy",
      name: "НеДеловой",
      description: "Бизнес-парк НеДеловой",
    },
  ];

  for (const park of parks) {
    await prisma.park.upsert({
      where: { slug: park.slug },
      update: { name: park.name, description: park.description },
      create: park,
    });
  }

  console.log(`  ✓ Parks: ${parks.map((p) => p.slug).join(", ")}`);
}
