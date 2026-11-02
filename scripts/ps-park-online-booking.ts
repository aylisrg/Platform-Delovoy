import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { hashDocumentBody } from "../src/modules/booking/offer";
import { setOnlineBookingEnabled } from "../src/modules/ps-park/online-settings";

async function main() {
  const [action = "check", actorId] = process.argv.slice(2);
  if (!["check", "enable", "disable"].includes(action)) throw new Error("Use: check | enable <existing-superadmin-id> | disable <existing-superadmin-id>");
  if (action === "check") {
    const park = await prisma.module.findUnique({ where: { slug: "ps-park" }, select: { config: true } });
    console.log(JSON.stringify({ onlineBookingEnabled: (park?.config as Record<string, unknown> | null)?.onlineBookingEnabled === true }));
    return;
  }
  if (!actorId) throw new Error("Existing SUPERADMIN id is required for audit");
  const offerHash = action === "enable" ? hashDocumentBody(readFileSync("content/legal/ps-park-offer/v2.md", "utf8")) : undefined;
  console.log(JSON.stringify(await setOnlineBookingEnabled(actorId, action === "enable", offerHash)));
}
main().catch((error) => {
  // Do not print Prisma connection strings or provider environment values.
  console.error(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "Play Park activation failed; check the command, published offer and database connection.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
