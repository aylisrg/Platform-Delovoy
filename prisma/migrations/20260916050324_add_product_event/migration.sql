-- CreateTable
CREATE TABLE "ProductEvent" (
    "id" TEXT NOT NULL,
    "funnel" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "sessionKey" TEXT,
    "moduleSlug" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductEvent_funnel_step_createdAt_idx" ON "ProductEvent"("funnel", "step", "createdAt");

-- CreateIndex
CREATE INDEX "ProductEvent_createdAt_idx" ON "ProductEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ProductEvent_entityId_idx" ON "ProductEvent"("entityId");
