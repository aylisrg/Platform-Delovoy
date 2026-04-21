import { prisma } from "@/lib/db";
import { redis, redisAvailable } from "@/lib/redis";
import { sendTelegramAlert } from "@/lib/telegram-alert";

const ALERT_DEDUP_TTL_SECONDS = 60 * 60 * 24; // 24 hours
const ALERT_KEY_PREFIX = "inventory:alert:low-stock:";

/**
 * Check if a product is below its minimum stock threshold and send a
 * Telegram notification if so. Rate-limited to 1 alert per product per 24h.
 */
export async function checkAndSendLowStockAlert(skuId: string): Promise<void> {
  try {
    const sku = await prisma.inventorySku.findUnique({
      where: { id: skuId },
      select: {
        id: true,
        name: true,
        unit: true,
        stockQuantity: true,
        lowStockThreshold: true,
        isActive: true,
      },
    });

    if (!sku || !sku.isActive) return;
    if (sku.stockQuantity >= sku.lowStockThreshold) return;

    // Check Redis dedup key
    const redisKey = `${ALERT_KEY_PREFIX}${skuId}`;
    if (redisAvailable) {
      const alreadySent = await redis.get(redisKey);
      if (alreadySent) return; // Already notified within 24h
    }

    // Find last supplier for this SKU (for reorder context)
    const lastReceipt = await prisma.stockReceipt.findFirst({
      where: { items: { some: { skuId } } },
      orderBy: { receivedAt: "desc" },
      include: { supplier: { select: { name: true, phone: true } } },
    });

    const supplierInfo = lastReceipt?.supplier
      ? `\nПоставщик: ${lastReceipt.supplier.name}${lastReceipt.supplier.phone ? ` (${lastReceipt.supplier.phone})` : ""}`
      : "";

    const message = buildLowStockMessage(
      sku.name,
      sku.stockQuantity,
      sku.unit,
      sku.lowStockThreshold,
      supplierInfo
    );

    const sent = await sendTelegramAlert(message);

    if (sent && redisAvailable) {
      await redis.setex(redisKey, ALERT_DEDUP_TTL_SECONDS, "1");
    }
  } catch (err) {
    // Alerts must never break the main flow
    console.error("[inventory/alerts] Low stock alert failed:", err);
  }
}

/**
 * Sweep all active SKUs and send low-stock alerts for any below threshold.
 * Called by the cron job.
 */
export async function runLowStockAlertSweep(): Promise<{ checked: number; alerted: number }> {
  const skus = await prisma.inventorySku.findMany({
    where: {
      isActive: true,
      lowStockThreshold: { gt: 0 },
    },
    select: {
      id: true,
      name: true,
      unit: true,
      stockQuantity: true,
      lowStockThreshold: true,
    },
  });

  let alerted = 0;

  for (const sku of skus) {
    if (sku.stockQuantity < sku.lowStockThreshold) {
      const redisKey = `${ALERT_KEY_PREFIX}${sku.id}`;

      if (redisAvailable) {
        const alreadySent = await redis.get(redisKey);
        if (alreadySent) continue;
      }

      const message = buildLowStockMessage(
        sku.name,
        sku.stockQuantity,
        sku.unit,
        sku.lowStockThreshold,
        ""
      );

      const sent = await sendTelegramAlert(message);
      if (sent) {
        alerted++;
        if (redisAvailable) {
          await redis.setex(redisKey, ALERT_DEDUP_TTL_SECONDS, "1");
        }
      }
    }
  }

  return { checked: skus.length, alerted };
}

function buildLowStockMessage(
  name: string,
  stockQuantity: number,
  unit: string,
  threshold: number,
  supplierInfo: string
): string {
  return [
    `⚠️ <b>Низкий остаток товара</b>`,
    ``,
    `Товар: <b>${name}</b>`,
    `Остаток: <b>${stockQuantity} ${unit}</b> (порог: ${threshold} ${unit})`,
    supplierInfo,
    ``,
    `<i>Рекомендуется заказать пополнение.</i>`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

