-- Default release notifications to ON for SUPERADMIN/MANAGER users.
-- USER role rows remain untouched — release notifications are filtered by role
-- in the query layer (`src/modules/notifications/release-notify.ts`).

-- 1. Flip the column default for any future NotificationPreference rows.
ALTER TABLE "NotificationPreference" ALTER COLUMN "notifyReleases" SET DEFAULT true;

-- 2. Backfill existing admins/managers who never explicitly opted in.
UPDATE "NotificationPreference" np
SET "notifyReleases" = true
FROM "User" u
WHERE np."userId" = u.id
  AND u.role IN ('SUPERADMIN', 'MANAGER')
  AND np."notifyReleases" = false;
