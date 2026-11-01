-- ADR 2026-10-25-team-access-notifications. Только аддитивно.

-- 1. User: версия сессии и последний вход
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

UPDATE "User" u SET "lastLoginAt" = s."last"
FROM (
  SELECT "userId", MAX("createdAt") AS "last"
  FROM "AuditLog" WHERE "action" = 'auth.signin.success'
  GROUP BY "userId"
) s
WHERE s."userId" = u."id";

-- ADMIN получает разделы по роли (Q10): освежить claims токенов без разлогина
UPDATE "User" SET "sessionVersion" = "sessionVersion" + 1 WHERE "role" = 'ADMIN';

-- 2. Последний актор подписки
ALTER TABLE "NotificationEventPreference" ADD COLUMN "updatedByUserId" TEXT;
ALTER TABLE "NotificationEventPreference" ADD COLUMN "updatedVia" TEXT;

-- 3. Диагностика доставки и реакции
ALTER TABLE "OutgoingNotification" ADD COLUMN "failureCode" TEXT;
ALTER TABLE "OutgoingNotification" ADD COLUMN "externalId" TEXT;
ALTER TABLE "OutgoingNotification" ADD COLUMN "clickedAt" TIMESTAMP(3);
ALTER TABLE "OutgoingNotification" ADD COLUMN "clickCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OutgoingNotification" ADD COLUMN "readVia" TEXT;
CREATE INDEX "OutgoingNotification_fallbackOfId_idx" ON "OutgoingNotification"("fallbackOfId");

ALTER TABLE "InAppNotification" ADD COLUMN "clickedAt" TIMESTAMP(3);
ALTER TABLE "InAppNotification" ADD COLUMN "clickCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InAppNotification" ADD COLUMN "readVia" TEXT;

-- 4. Списки получателей разделов: таблица + перенос из JSON
CREATE TABLE "ModuleNotificationRecipient" (
    "moduleSlug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModuleNotificationRecipient_pkey" PRIMARY KEY ("moduleSlug", "userId")
);
CREATE INDEX "ModuleNotificationRecipient_userId_idx" ON "ModuleNotificationRecipient"("userId");
ALTER TABLE "ModuleNotificationRecipient" ADD CONSTRAINT "ModuleNotificationRecipient_moduleSlug_fkey"
    FOREIGN KEY ("moduleSlug") REFERENCES "Module"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModuleNotificationRecipient" ADD CONSTRAINT "ModuleNotificationRecipient_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ModuleNotificationRecipient" ("moduleSlug", "userId")
SELECT DISTINCT m."slug", COALESCE(u."mergedIntoUserId", u."id")
FROM "Module" m
CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(m."config"->'notificationRecipients') = 'array'
         THEN m."config"->'notificationRecipients' ELSE '[]'::jsonb END
) AS r("uid")
JOIN "User" u ON u."id" = r."uid"
ON CONFLICT DO NOTHING;

-- 5. Трекинг-ссылки
CREATE TABLE "NotificationLink" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "outgoingId" TEXT NOT NULL,
    "actionIndex" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "firstClickAt" TIMESTAMP(3),
    "lastClickAt" TIMESTAMP(3),
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "NotificationLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NotificationLink_code_key" ON "NotificationLink"("code");
CREATE UNIQUE INDEX "NotificationLink_outgoingId_actionIndex_key" ON "NotificationLink"("outgoingId", "actionIndex");
CREATE INDEX "NotificationLink_expiresAt_idx" ON "NotificationLink"("expiresAt");
CREATE INDEX "NotificationLink_userId_createdAt_idx" ON "NotificationLink"("userId", "createdAt");
ALTER TABLE "NotificationLink" ADD CONSTRAINT "NotificationLink_outgoingId_fkey"
    FOREIGN KEY ("outgoingId") REFERENCES "OutgoingNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Пропуски доставки
CREATE TABLE "NotificationDeliverySkip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationDeliverySkip_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NotificationDeliverySkip_userId_createdAt_idx" ON "NotificationDeliverySkip"("userId", "createdAt");
CREATE INDEX "NotificationDeliverySkip_createdAt_idx" ON "NotificationDeliverySkip"("createdAt");

-- 7. Контакт с ботом + бэкфилл «запущен (дата неизвестна)» (AC-E1.5)
CREATE TABLE "TelegramBotContact" (
    "telegramId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "startedBackfill" BOOLEAN NOT NULL DEFAULT false,
    "lastContactAt" TIMESTAMP(3),
    "lastDeliveryOkAt" TIMESTAMP(3),
    "blockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramBotContact_pkey" PRIMARY KEY ("telegramId")
);

INSERT INTO "TelegramBotContact" ("telegramId", "startedBackfill", "updatedAt")
SELECT DISTINCT x."tg", true, CURRENT_TIMESTAMP
FROM (
    SELECT c."address" AS "tg"
    FROM "OutgoingNotification" o
    JOIN "UserNotificationChannel" c ON c."id" = o."channelId"
    WHERE c."kind" = 'TELEGRAM' AND o."status" = 'SENT'
  UNION
    SELECT u."telegramId"
    FROM "User" u
    WHERE u."telegramId" IS NOT NULL AND (
         u."source" = 'telegram_bot'
      OR EXISTS (SELECT 1 FROM "Account" a WHERE a."userId" = u."id" AND a."provider" = 'telegram-token')
      OR EXISTS (SELECT 1 FROM "NotificationLog" l
                 WHERE l."userId" = u."id" AND l."channel" = 'TELEGRAM' AND l."status" = 'SENT')
    )
) x
WHERE x."tg" ~ '^[0-9]+$'
ON CONFLICT ("telegramId") DO NOTHING;
