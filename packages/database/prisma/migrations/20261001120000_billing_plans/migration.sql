-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'VOID', 'UNCOLLECTIBLE');

-- CreateEnum
CREATE TYPE "BillingEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FeatureFlagKey" ADD VALUE 'CALENDAR_SYNC';
ALTER TYPE "FeatureFlagKey" ADD VALUE 'API_ACCESS';
ALTER TYPE "FeatureFlagKey" ADD VALUE 'WEBHOOKS';
ALTER TYPE "FeatureFlagKey" ADD VALUE 'PRIORITY_SUPPORT';
ALTER TYPE "FeatureFlagKey" ADD VALUE 'REMOVE_BRANDING';
ALTER TYPE "FeatureFlagKey" ADD VALUE 'WHITE_LABEL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SubscriptionStatus" ADD VALUE 'UNPAID';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'INCOMPLETE';
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PAUSED';

-- AlterEnum
ALTER TYPE "UsageMetric" ADD VALUE 'AUTOMATIONS';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "billingCustomerId" TEXT;

-- AlterTable
ALTER TABLE "Plan" RENAME COLUMN "priceCents" TO "priceMonthlyCents";

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "highlight" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "priceYearlyCents" INTEGER,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stripePriceMonthlyId" TEXT,
ADD COLUMN     "stripePriceYearlyId" TEXT,
ADD COLUMN     "tagline" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cancelledAt" TIMESTAMPTZ(6),
ADD COLUMN     "externalUpdatedAt" TIMESTAMPTZ(6),
ADD COLUMN     "interval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "trialEndsAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trialUsedAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "number" TEXT,
    "status" "InvoiceStatus" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "amountDueCents" INTEGER NOT NULL,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "planKey" TEXT,
    "interval" "BillingInterval",
    "periodStart" TIMESTAMPTZ(6),
    "periodEnd" TIMESTAMPTZ(6),
    "hostedUrl" TEXT,
    "pdfUrl" TEXT,
    "paymentId" TEXT,
    "paidAt" TIMESTAMPTZ(6),
    "issuedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "status" "BillingEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "companyId" UUID,
    "objectId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_externalId_key" ON "Invoice"("externalId");

-- CreateIndex
CREATE INDEX "Invoice_companyId_issuedAt_idx" ON "Invoice"("companyId", "issuedAt");

-- CreateIndex
CREATE INDEX "BillingEvent_companyId_receivedAt_idx" ON "BillingEvent"("companyId", "receivedAt");

-- CreateIndex
CREATE INDEX "BillingEvent_status_receivedAt_idx" ON "BillingEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_provider_externalId_key" ON "BillingEvent"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_billingCustomerId_key" ON "Company"("billingCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_stripePriceMonthlyId_key" ON "Plan"("stripePriceMonthlyId");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_stripePriceYearlyId_key" ON "Plan"("stripePriceYearlyId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_externalId_key" ON "Subscription"("externalId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

