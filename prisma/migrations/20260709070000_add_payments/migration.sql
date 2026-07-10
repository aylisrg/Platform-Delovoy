-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'WAITING_FOR_CAPTURE', 'SUCCEEDED', 'CANCELED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentSubjectType" AS ENUM ('BOOKING', 'SUBSCRIPTION', 'ORDER', 'RENTAL_PAYMENT');

-- AlterEnum
ALTER TYPE "FinancialTxType" ADD VALUE 'ONLINE_PAYMENT';

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PENDING_PAYMENT';

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'yookassa',
    "providerPaymentId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(10,2) NOT NULL,
    "refundedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "subjectType" "PaymentSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "moduleSlug" TEXT NOT NULL,
    "userId" TEXT,
    "createdById" TEXT,
    "confirmationUrl" TEXT,
    "description" TEXT NOT NULL,
    "idempotenceKey" TEXT NOT NULL,
    "paymentMethodType" TEXT,
    "cancellationReason" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "idempotenceKey" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotenceKey_key" ON "Payment"("idempotenceKey");

-- CreateIndex
CREATE INDEX "Payment_subjectType_subjectId_idx" ON "Payment"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_moduleSlug_createdAt_idx" ON "Payment"("moduleSlug", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_providerRefundId_key" ON "PaymentRefund"("providerRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_idempotenceKey_key" ON "PaymentRefund"("idempotenceKey");

-- CreateIndex
CREATE INDEX "PaymentRefund_paymentId_idx" ON "PaymentRefund"("paymentId");

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

