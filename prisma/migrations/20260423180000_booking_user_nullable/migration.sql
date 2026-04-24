-- Guest checkout: Booking.userId becomes nullable so public booking endpoints
-- can create bookings without an authenticated user (captured by clientName +
-- clientPhone instead). Existing bookings already have userId filled, so the
-- only change is dropping the NOT NULL + re-declaring the FK as optional.

ALTER TABLE "Booking" ALTER COLUMN "userId" DROP NOT NULL;
