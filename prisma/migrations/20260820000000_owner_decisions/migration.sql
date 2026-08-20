-- CreateEnum
CREATE TYPE "OwnerDecisionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DEFERRED', 'EXECUTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "OwnerDecision" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectNumber" INTEGER,
    "headSha" TEXT,
    "title" TEXT NOT NULL,
    "payload" JSONB,
    "status" "OwnerDecisionStatus" NOT NULL DEFAULT 'PENDING',
    "decision" TEXT,
    "note" TEXT,
    "executorNote" TEXT,
    "telegramMessageId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerDecision_kind_subjectNumber_headSha_key" ON "OwnerDecision"("kind", "subjectNumber", "headSha");

-- CreateIndex
CREATE INDEX "OwnerDecision_status_createdAt_idx" ON "OwnerDecision"("status", "createdAt");
