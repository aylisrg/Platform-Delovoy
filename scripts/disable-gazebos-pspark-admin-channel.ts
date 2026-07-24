/**
 * One-off: stop all Telegram notifications going to the shared
 * "Delovoy-Admin-Беседки-Плейст-бронь" group for gazebos + ps-park.
 *
 * Disables both notification mechanisms for these two modules without
 * touching the stored chat ID / bot token, so it can be flipped back on
 * later (via /admin/monitoring or PATCH /api/{module}/settings) without
 * re-entering them:
 *   - telegramAdminChatEnabled = false  (admin routing chat, booking.created/cancelled)
 *   - telegramChannelEnabled   = false  (dedicated module channel, booking.paid/cancelled/...)
 *
 * Idempotent — safe to re-run.
 * Usage: npx tsx scripts/disable-gazebos-pspark-admin-channel.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MODULE_SLUGS = ["gazebos", "ps-park"];

async function main() {
  for (const slug of MODULE_SLUGS) {
    const mod = await prisma.module.findUnique({ where: { slug } });
    if (!mod) {
      console.log(`  ✗ Module "${slug}" not found — skipping`);
      continue;
    }

    const existing = (mod.config as Record<string, unknown>) ?? {};
    const updated = {
      ...existing,
      telegramAdminChatEnabled: false,
      telegramChannelEnabled: false,
    };

    await prisma.module.update({
      where: { slug },
      data: { config: updated },
    });

    console.log(
      `  ✓ ${slug}: admin routing chat + dedicated channel disabled (chat IDs preserved)`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
