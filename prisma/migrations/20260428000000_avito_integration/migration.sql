-- Avito integration: 6 new tables + 4 enums + extension of NotificationChannelKind.
-- All changes are additive — no existing data is touched.
-- See docs/architecture/2026-04-28-delovoy-avito-adr.md

-- AlterEnum
ALTER TYPE "NotificationChannelKind" ADD VALUE 'AVITO';

-- CreateEnum
CREATE TYPE "AvitoItemStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'BLOCKED', 'REMOVED');

-- CreateEnum
CREATE TYPE "AvitoMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "AvitoCallStatus" AS ENUM ('ANSWERED', 'MISSED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "AvitoIntegration" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "avitoUserId" TEXT,
    "accountName" TEXT,
    "webhookSecret" TEXT,
    "webhookSecretRotatedAt" TIMESTAMP(3),
    "webhookEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pollEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastBalanceRub" DECIMAL(65,30),
    "lastBalanceSyncAt" TIMESTAMP(3),
    "lastAccountSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvitoIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvitoItem" (
    "id" TEXT NOT NULL,
    "avitoItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "status" "AvitoItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "moduleSlug" TEXT,
    "category" TEXT,
    "priceRub" DECIMAL(65,30),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "avgRating" DOUBLE PRECISION,
    "reviewsCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AvitoItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AvitoItem_avitoItemId_key" ON "AvitoItem"("avitoItemId");

-- CreateIndex
CREATE INDEX "AvitoItem_moduleSlug_status_idx" ON "AvitoItem"("moduleSlug", "status");

-- CreateIndex
CREATE INDEX "AvitoItem_deletedAt_idx" ON "AvitoItem"("deletedAt");

-- CreateTable
CREATE TABLE "AvitoMessage" (
    "id" TEXT NOT NULL,
    "avitoMessageId" TEXT NOT NULL,
    "avitoChatId" TEXT NOT NULL,
    "avitoItemId" TEXT,
    "direction" "AvitoMessageDirection" NOT NULL,
    "authorAvitoUserId" TEXT,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "taskId" TEXT,
    "taskCommentId" TEXT,
    "rawPayload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvitoMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AvitoMessage_avitoMessageId_key" ON "AvitoMessage"("avitoMessageId");

-- CreateIndex
CREATE INDEX "AvitoMessage_avitoChatId_receivedAt_idx" ON "AvitoMessage"("avitoChatId", "receivedAt");

-- CreateIndex
CREATE INDEX "AvitoMessage_avitoItemId_idx" ON "AvitoMessage"("avitoItemId");

-- CreateIndex
CREATE INDEX "AvitoMessage_taskId_idx" ON "AvitoMessage"("taskId");

-- CreateIndex
CREATE INDEX "AvitoMessage_direction_createdAt_idx" ON "AvitoMessage"("direction", "createdAt");

-- CreateTable
CREATE TABLE "AvitoReview" (
    "id" TEXT NOT NULL,
    "avitoReviewId" TEXT NOT NULL,
    "avitoItemId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "authorName" TEXT,
    "body" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "alertSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvitoReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AvitoReview_avitoReviewId_key" ON "AvitoReview"("avitoReviewId");

-- CreateIndex
CREATE INDEX "AvitoReview_avitoItemId_rating_idx" ON "AvitoReview"("avitoItemId", "rating");

-- CreateIndex
CREATE INDEX "AvitoReview_alertSent_rating_idx" ON "AvitoReview"("alertSent", "rating");

-- CreateIndex
CREATE INDEX "AvitoReview_reviewedAt_idx" ON "AvitoReview"("reviewedAt");

-- CreateTable
CREATE TABLE "AvitoCallEvent" (
    "id" TEXT NOT NULL,
    "avitoCallId" TEXT NOT NULL,
    "avitoItemId" TEXT,
    "callerPhone" TEXT,
    "status" "AvitoCallStatus" NOT NULL,
    "durationSec" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "taskId" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvitoCallEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AvitoCallEvent_avitoCallId_key" ON "AvitoCallEvent"("avitoCallId");

-- CreateIndex
CREATE INDEX "AvitoCallEvent_avitoItemId_status_idx" ON "AvitoCallEvent"("avitoItemId", "status");

-- CreateIndex
CREATE INDEX "AvitoCallEvent_startedAt_idx" ON "AvitoCallEvent"("startedAt");

-- CreateIndex
CREATE INDEX "AvitoCallEvent_taskId_idx" ON "AvitoCallEvent"("taskId");

-- CreateTable
CREATE TABLE "AvitoItemStatsSnapshot" (
    "id" TEXT NOT NULL,
    "avitoItemId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "uniqViews" INTEGER NOT NULL DEFAULT 0,
    "contacts" INTEGER NOT NULL DEFAULT 0,
    "favorites" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "missedCalls" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvitoItemStatsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AvitoItemStatsSnapshot_avitoItemId_period_key" ON "AvitoItemStatsSnapshot"("avitoItemId", "period");

-- CreateIndex
CREATE INDEX "AvitoItemStatsSnapshot_syncedAt_idx" ON "AvitoItemStatsSnapshot"("syncedAt");

-- AddForeignKey
ALTER TABLE "AvitoMessage" ADD CONSTRAINT "AvitoMessage_avitoItemId_fkey" FOREIGN KEY ("avitoItemId") REFERENCES "AvitoItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvitoReview" ADD CONSTRAINT "AvitoReview_avitoItemId_fkey" FOREIGN KEY ("avitoItemId") REFERENCES "AvitoItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvitoCallEvent" ADD CONSTRAINT "AvitoCallEvent_avitoItemId_fkey" FOREIGN KEY ("avitoItemId") REFERENCES "AvitoItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvitoItemStatsSnapshot" ADD CONSTRAINT "AvitoItemStatsSnapshot_avitoItemId_fkey" FOREIGN KEY ("avitoItemId") REFERENCES "AvitoItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Singleton row for AvitoIntegration. Idempotent.
INSERT INTO "AvitoIntegration" ("id", "createdAt", "updatedAt")
VALUES ('default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
