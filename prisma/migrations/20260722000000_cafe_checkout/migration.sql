-- Cafe online checkout (YooKassa, guest-friendly):
--   Order.userId → nullable (гостевые QR-заказы), paidAt, comment
--   OrderItem.name — снапшот названия позиции на момент заказа

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "comment" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "name" TEXT;

-- CreateIndex
CREATE INDEX "Order_moduleSlug_paidAt_idx" ON "Order"("moduleSlug", "paidAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: снапшот названий для существующих строк заказов
UPDATE "OrderItem" oi
SET "name" = mi."name"
FROM "MenuItem" mi
WHERE oi."menuItemId" = mi."id" AND oi."name" IS NULL;
