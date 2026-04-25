-- Add optional officeId FK to FeedbackItem so users can link their
-- feedback to a specific office in the registry. NULL is valid for
-- guests and all existing rows. Future iteration may auto-fill from
-- the user's active RentalContract — schema is already prepared.

ALTER TABLE "FeedbackItem"
  ADD COLUMN "officeId" TEXT;

ALTER TABLE "FeedbackItem"
  ADD CONSTRAINT "FeedbackItem_officeId_fkey"
  FOREIGN KEY ("officeId") REFERENCES "Office"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "FeedbackItem_officeId_idx" ON "FeedbackItem"("officeId");
