-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "billable" BOOLEAN,
ADD COLUMN     "pricingCategory" TEXT,
ADD COLUMN     "pricingModel" TEXT;

-- CreateIndex
CREATE INDEX "Message_billable_createdAt_idx" ON "Message"("billable", "createdAt");
