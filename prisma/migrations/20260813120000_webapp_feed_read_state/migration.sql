-- Лента Mini App: отметка прочтения персональных уведомлений + watermark
-- просмотра новостей парка (ADR 2026-08-13-miniapp-role-rebuild §3.1, §9).
-- Аддитивно: только ADD COLUMN / CREATE INDEX.

ALTER TABLE "OutgoingNotification" ADD COLUMN "readAt" TIMESTAMP(3);

CREATE INDEX "OutgoingNotification_userId_readAt_idx" ON "OutgoingNotification"("userId", "readAt");

ALTER TABLE "NotificationGlobalPreference" ADD COLUMN "feedSeenAt" TIMESTAMP(3);
