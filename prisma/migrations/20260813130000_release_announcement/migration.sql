-- Реестр анонсированных релизов: серверная идемпотентность релиз-анонса
-- (ADR 2026-08-13-miniapp-role-rebuild §6) + бэкфилл-перенос легаси-подписки
-- NotificationPreference.notifyReleases -> NotificationEventPreference 1:1
-- и каналов доставки для легаси-подписчиков (AC-6.5).
-- Аддитивно: CREATE TABLE / CREATE INDEX / INSERT ... ON CONFLICT DO NOTHING.

CREATE TABLE "ReleaseAnnouncement" (
    "version" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "releaseNotes" TEXT NOT NULL,
    "announcedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'deploy',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseAnnouncement_pkey" PRIMARY KEY ("version")
);

CREATE INDEX "ReleaseAnnouncement_announcedAt_idx" ON "ReleaseAnnouncement"("announcedAt");

-- Бэкфилл 1: явные подписки system.release из легаси-колонки.
-- COALESCE: колонка default true, строки NotificationPreference может не быть.
-- Аудитория ровно та, которой слал легаси release-notify: SUPERADMIN + MANAGER.
INSERT INTO "NotificationEventPreference"
  ("id","userId","eventType","enabled","channelKinds","quietWeekdaysOnly","timezone","createdAt","updatedAt")
SELECT gen_random_uuid()::text, u."id", 'system.release',
       COALESCE(np."notifyReleases", true), ARRAY[]::"NotificationChannelKind"[],
       false, 'Europe/Moscow', NOW(), NOW()
FROM "User" u
LEFT JOIN "NotificationPreference" np ON np."userId" = u."id"
WHERE u."role" IN ('SUPERADMIN','MANAGER')
  AND u."mergedIntoUserId" IS NULL
ON CONFLICT ("userId","eventType") DO NOTHING;

-- Бэкфилл 2: канал доставки Telegram для тех, кто реально получал релизы
-- напрямую по telegramId. Без канала dispatch() молча потерял бы подписчика.
INSERT INTO "UserNotificationChannel"
  ("id","userId","kind","address","label","priority","isActive","verifiedAt","createdAt","updatedAt")
SELECT gen_random_uuid()::text, u."id", 'TELEGRAM', u."telegramId", 'Telegram',
       10, true, NOW(), NOW(), NOW()
FROM "User" u
LEFT JOIN "NotificationPreference" np ON np."userId" = u."id"
WHERE u."role" IN ('SUPERADMIN','MANAGER')
  AND u."telegramId" IS NOT NULL
  AND u."mergedIntoUserId" IS NULL
  AND COALESCE(np."notifyReleases", true) = true
ON CONFLICT ("userId","kind","address") DO NOTHING;
