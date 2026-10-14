-- #1066 PR1: журнал звонков Novofon. Только новая таблица, существующие не трогаются.

-- CreateTable
CREATE TABLE "NovofonCall" (
    "id" TEXT NOT NULL,
    "communicationId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "direction" "CallDirection" NOT NULL,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    "finishReason" TEXT,
    "virtualPhoneNumber" TEXT,
    "contactPhone" TEXT,
    "waitDuration" INTEGER,
    "talkDuration" INTEGER,
    "totalDuration" INTEGER,
    "employeeId" TEXT,
    "employeeName" TEXT,
    "recordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NovofonCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NovofonCall_startedAt_idx" ON "NovofonCall"("startedAt");

-- CreateIndex
CREATE INDEX "NovofonCall_contactPhone_startedAt_idx" ON "NovofonCall"("contactPhone", "startedAt");

-- CreateIndex
CREATE INDEX "NovofonCall_isLost_startedAt_idx" ON "NovofonCall"("isLost", "startedAt");
