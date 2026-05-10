-- F5 ADR 2026-05-04-cafe-order-booking-link: link cafe Order to Booking.
-- NULLable, no backfill, ON DELETE SET NULL keeps the order as a financial
-- document if the booking is hard-deleted.

ALTER TABLE "Order" ADD COLUMN "bookingId" TEXT;

CREATE INDEX "Order_bookingId_idx" ON "Order"("bookingId");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "Booking"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
