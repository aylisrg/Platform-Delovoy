/**
 * Nedelovoy grants seed — auto-grants nedelovoy access to all SUPERADMIN users.
 *
 * Строгий доступ к НеДеловой требует явного гранта для всех, включая SUPERADMIN.
 * Этот сидер устраняет bootstrap-проблему: SUPERADMIN не может войти в раздел
 * НеДеловой без гранта, но и не может выдать его себе без доступа к UI.
 *
 * Идемпотентность: upsert по userId+section и userId+moduleId. Безопасно запускать повторно.
 * Запускается ПОСЛЕ seedCore (нужна Module-запись "nedelovoy").
 */
import type { PrismaClient } from "@prisma/client";

export async function seedNedelovoyGrants(prisma: PrismaClient): Promise<void> {
  const superadmins = await prisma.user.findMany({
    where: { role: "SUPERADMIN" },
    select: { id: true },
  });

  if (superadmins.length === 0) {
    console.log("  ✓ NedelovoyGrants: no SUPERADMIN users found, skipping");
    return;
  }

  const nedelovoyModule = await prisma.module.findUnique({
    where: { slug: "nedelovoy" },
    select: { id: true },
  });

  let granted = 0;
  for (const sa of superadmins) {
    // AdminPermission — доступ к /admin/nedelovoy
    await prisma.adminPermission.upsert({
      where: { userId_section: { userId: sa.id, section: "nedelovoy" } },
      update: {},
      create: { userId: sa.id, section: "nedelovoy" },
    });

    // ModuleAssignment — доступ к API /api/nedelovoy/*
    if (nedelovoyModule) {
      await prisma.moduleAssignment.upsert({
        where: { userId_moduleId: { userId: sa.id, moduleId: nedelovoyModule.id } },
        update: {},
        create: { userId: sa.id, moduleId: nedelovoyModule.id },
      });
    }

    granted++;
  }

  console.log(`  ✓ NedelovoyGrants: granted nedelovoy access to ${granted} SUPERADMIN user(s)`);
}
