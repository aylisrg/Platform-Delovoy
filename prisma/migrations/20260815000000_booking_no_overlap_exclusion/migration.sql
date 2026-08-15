-- issue #548: DB-level backstop against double-booking, on top of the
-- advisory-lock in src/modules/booking/slot-lock.ts (#429). Mirrors the
-- app-level conflict check exactly (see ACTIVE_BOOKING_STATUSES in
-- state-machine.ts and the findFirst() overlap query in gazebos/ps-park
-- service.ts): active statuses only, soft-deleted rows excluded, half-open
-- interval overlap (touching bookings do not conflict).
--
-- btree_gist needed for equality GiST operator classes on moduleSlug/
-- resourceId (text); it is a "trusted" extension since PG13, so a plain
-- database-owner role can create it without superuser.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT "booking_no_overlap"
  EXCLUDE USING gist (
    "moduleSlug" WITH =,
    "resourceId" WITH =,
    tsrange("startTime", "endTime") WITH &&
  )
  WHERE ("status" IN ('PENDING', 'CONFIRMED', 'CHECKED_IN') AND "deletedAt" IS NULL);
