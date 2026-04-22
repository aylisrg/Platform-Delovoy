/**
 * Recalculates InventorySku.stockQuantity from SUM(StockBatch.remainingQty)
 * for non-exhausted batches. Run when the denormalized counter has drifted.
 *
 * Usage: npx tsx scripts/resync-stock-quantity.ts
 *        DRY_RUN=1 npx tsx scripts/resync-stock-quantity.ts
 */
import { prisma } from "../src/lib/db";

async function main() {
  const dryRun = process.env.DRY_RUN === "1";
  const skus = await prisma.inventorySku.findMany({ select: { id: true, name: true, stockQuantity: true } });
  const sums = await prisma.stockBatch.groupBy({
    by: ["skuId"],
    _sum: { remainingQty: true },
    where: { isExhausted: false },
  });
  const realBySku = new Map(sums.map((s) => [s.skuId, s._sum.remainingQty ?? 0]));

  let drifted = 0;
  let fixed = 0;
  for (const sku of skus) {
    const real = realBySku.get(sku.id) ?? 0;
    if (real === sku.stockQuantity) continue;
    drifted++;
    console.log(`${sku.name} (${sku.id}): denormalized=${sku.stockQuantity} real=${real} delta=${real - sku.stockQuantity}`);
    if (!dryRun) {
      await prisma.inventorySku.update({ where: { id: sku.id }, data: { stockQuantity: real } });
      fixed++;
    }
  }

  console.log(`\nScanned ${skus.length} SKUs. Drift: ${drifted}. ${dryRun ? "(DRY_RUN — nothing written)" : `Fixed: ${fixed}`}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
