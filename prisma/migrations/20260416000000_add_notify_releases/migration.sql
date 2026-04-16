-- Add notifyReleases field to NotificationPreference
-- Administrators and managers can opt-in to receive Telegram release notifications

ALTER TABLE "NotificationPreference"
  ADD COLUMN IF NOT EXISTS "notifyReleases" BOOLEAN NOT NULL DEFAULT false;
