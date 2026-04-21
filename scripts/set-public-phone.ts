import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PHONE = "+74996774888";
const DISPLAY_PHONE = "+7 499 677-48-88";
const MODULES = ["gazebos", "ps-park"];

async function main() {
  for (const slug of MODULES) {
    const mod = await prisma.module.findUnique({ where: { slug } });
    if (!mod) {
      console.log(`  ✗ Module "${slug}" not found`);
      continue;
    }

    const existing = (mod.config as Record<string, unknown>) ?? {};
    const updated = {
      ...existing,
      telephony: {
        ...((existing.telephony as Record<string, unknown>) ?? {}),
        enabled: true,
        publicPhone: PHONE,
        displayPhone: DISPLAY_PHONE,
      },
    };

    await prisma.module.update({
      where: { slug },
      data: { config: updated },
    });

    console.log(`  ✓ ${slug}: телефон установлен`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
