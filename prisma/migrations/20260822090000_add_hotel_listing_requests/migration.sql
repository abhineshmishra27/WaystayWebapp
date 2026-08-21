CREATE TYPE "HotelListingRequestStatus" AS ENUM ('PENDING', 'REVIEWED', 'REJECTED');

CREATE TABLE "HotelListingRequest" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "hotelName" TEXT NOT NULL,
    "gstNumber" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "roomCount" INTEGER,
    "message" TEXT,
    "status" "HotelListingRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotelListingRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HotelListingRequest_ownerId_status_createdAt_idx" ON "HotelListingRequest"("ownerId", "status", "createdAt");
CREATE INDEX "HotelListingRequest_status_createdAt_idx" ON "HotelListingRequest"("status", "createdAt");

ALTER TABLE "HotelListingRequest"
ADD CONSTRAINT "HotelListingRequest_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HotelListingRequest"
ADD CONSTRAINT "HotelListingRequest_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
