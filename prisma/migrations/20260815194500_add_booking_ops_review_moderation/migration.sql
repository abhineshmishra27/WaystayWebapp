ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND_PENDING' BEFORE 'REFUNDED';

CREATE TYPE "ReviewStatus" AS ENUM ('PUBLISHED', 'HIDDEN');

ALTER TABLE "Booking"
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancellationReason" TEXT;

ALTER TABLE "Payment"
ADD COLUMN "providerRefundId" TEXT,
ADD COLUMN "refundedAt" TIMESTAMP(3);

ALTER TABLE "Review"
ADD COLUMN "status" "ReviewStatus" NOT NULL DEFAULT 'PUBLISHED',
ADD COLUMN "moderationReason" TEXT,
ADD COLUMN "moderatedAt" TIMESTAMP(3);

CREATE INDEX "Review_status_createdAt_idx" ON "Review"("status", "createdAt");
