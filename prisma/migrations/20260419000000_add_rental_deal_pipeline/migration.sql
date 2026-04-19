-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('NEW_LEAD', 'QUALIFICATION', 'SHOWING', 'PROPOSAL', 'NEGOTIATION', 'CONTRACT_DRAFT', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "DealPriority" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "DealSource" AS ENUM ('WEBSITE', 'PHONE', 'WALK_IN', 'REFERRAL', 'AVITO', 'CIAN', 'OTHER');

-- CreateTable
CREATE TABLE "RentalDeal" (
    "id" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "companyName" TEXT,
    "stage" "DealStage" NOT NULL DEFAULT 'NEW_LEAD',
    "priority" "DealPriority" NOT NULL DEFAULT 'WARM',
    "source" "DealSource" NOT NULL DEFAULT 'WEBSITE',
    "desiredArea" TEXT,
    "budget" TEXT,
    "moveInDate" TIMESTAMP(3),
    "requirements" TEXT,
    "officeId" TEXT,
    "inquiryId" TEXT,
    "tenantId" TEXT,
    "contractId" TEXT,
    "dealValue" DECIMAL(65,30),
    "nextActionDate" TIMESTAMP(3),
    "nextAction" TEXT,
    "lostReason" TEXT,
    "adminNotes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalDeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentalDeal_stage_idx" ON "RentalDeal"("stage");

-- CreateIndex
CREATE INDEX "RentalDeal_priority_idx" ON "RentalDeal"("priority");

-- CreateIndex
CREATE INDEX "RentalDeal_nextActionDate_idx" ON "RentalDeal"("nextActionDate");

-- CreateIndex
CREATE INDEX "RentalDeal_createdAt_idx" ON "RentalDeal"("createdAt");

-- AddForeignKey
ALTER TABLE "RentalDeal" ADD CONSTRAINT "RentalDeal_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "Office"("id") ON DELETE SET NULL ON UPDATE CASCADE;
