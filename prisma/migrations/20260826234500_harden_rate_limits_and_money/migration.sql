ALTER TABLE "Booking"
ALTER COLUMN "totalAmount" TYPE DECIMAL(12, 2)
USING ROUND("totalAmount"::NUMERIC, 2);

ALTER TABLE "BookingExtension"
ALTER COLUMN "additionalAmount" TYPE DECIMAL(12, 2)
USING ROUND("additionalAmount"::NUMERIC, 2);

ALTER TABLE "Payment"
ALTER COLUMN "amount" TYPE DECIMAL(12, 2)
USING ROUND("amount"::NUMERIC, 2);

CREATE TABLE "RateLimitBucket" (
    "keyHash" VARCHAR(64) NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("keyHash")
);

CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");
