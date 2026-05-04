-- F6: Subscriptions module — see ADR 2026-05-04-subscriptions-module-impl
-- New table + partial UNIQUE for "one ACTIVE per userId" invariant.

CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DEPLETED', 'CANCELLED');
CREATE TYPE "SubscriptionTransactionType" AS ENUM ('CHARGE', 'REFUND', 'MANUAL_TOPUP', 'MANUAL_DEDUCT');

CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "moduleSlug" TEXT NOT NULL DEFAULT 'ps-park',
    "userId" TEXT NOT NULL,
    "totalHours" DECIMAL(10,2) NOT NULL,
    "remainingHours" DECIMAL(10,2) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "pricePaid" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionTransaction" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" "SubscriptionTransactionType" NOT NULL,
    "hoursDelta" DECIMAL(10,2) NOT NULL,
    "balanceAfter" DECIMAL(10,2) NOT NULL,
    "bookingId" TEXT,
    "reason" TEXT,
    "performedById" TEXT NOT NULL,
    "performedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");
CREATE INDEX "Subscription_status_validTo_idx" ON "Subscription"("status", "validTo");
CREATE INDEX "Subscription_moduleSlug_createdAt_idx" ON "Subscription"("moduleSlug", "createdAt");

CREATE INDEX "SubscriptionTransaction_subscriptionId_createdAt_idx"
    ON "SubscriptionTransaction"("subscriptionId", "createdAt");
CREATE INDEX "SubscriptionTransaction_type_createdAt_idx"
    ON "SubscriptionTransaction"("type", "createdAt");
CREATE INDEX "SubscriptionTransaction_bookingId_idx"
    ON "SubscriptionTransaction"("bookingId");

-- Partial UNIQUE: at most one ACTIVE subscription per user.
-- Prisma cannot express partial indexes; this is the DB-level guarantee
-- that the F6 invariant (PRD §Бизнес-правила) cannot be violated even
-- under concurrent writes (P2002 → SubscriptionError ACTIVE_SUBSCRIPTION_EXISTS).
CREATE UNIQUE INDEX "subscription_user_active_unique"
    ON "Subscription" ("userId") WHERE "status" = 'ACTIVE';

ALTER TABLE "Subscription"
    ADD CONSTRAINT "Subscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "SubscriptionTransaction"
    ADD CONSTRAINT "SubscriptionTransaction_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;
