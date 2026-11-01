import { PrismaClient } from "@prisma/client";
import { PUBLIC_CONTACTS } from "../src/lib/public-contacts";

const prisma = new PrismaClient();

async function main() {
  for (const [slug, contact] of Object.entries(PUBLIC_CONTACTS)) {
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
        publicPhone: contact.phone,
        displayPhone: contact.displayPhone,
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
