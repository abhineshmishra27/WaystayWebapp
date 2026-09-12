-- Channel manager connections, mappings and sync audit log.
--
-- NOTE: this file was generated with `prisma migrate diff` and then hand-edited to
-- remove statements Prisma emits because the live schema contains objects the Prisma
-- datamodel cannot express. Do not regenerate it blindly - the diff wanted to:
--   * DROP INDEX "Hotel_geoPoint_gist_idx"          (PostGIS index behind radius search)
--   * DROP INDEX "Location_normalizedName_trgm_idx" (pg_trgm index behind fuzzy search)
--   * DROP INDEX "LocationAlias_normalizedAlias_trgm_idx"
--   * ALTER TABLE "Hotel" ALTER COLUMN "geoPoint" DROP DEFAULT (it is GENERATED ALWAYS)
--   * drop pre-existing updatedAt defaults on "Location" and "RateLimitBucket"
-- All of those are unrelated pre-existing drift and dropping them would silently
-- destroy search performance.

-- CreateEnum
CREATE TYPE "ChannelProvider" AS ENUM ('CLOUDBEDS');

-- CreateEnum
CREATE TYPE "ChannelConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ChannelSyncKind" AS ENUM ('IMPORT', 'AVAILABILITY', 'PUSH', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "ChannelSyncOutcome" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ChannelPushStatus" AS ENUM ('PENDING', 'PUSHED', 'FAILED', 'ABANDONED');

-- AlterTable
-- Channel-imported properties are not Indian-registered and have no GST/licence number.
ALTER TABLE "Hotel" ADD COLUMN     "channelConnectionId" TEXT,
ADD COLUMN     "externalPropertyId" TEXT,
ALTER COLUMN "license_number" DROP NOT NULL,
ALTER COLUMN "gst_number" DROP NOT NULL;

-- AlterTable
-- WayStay-specific housekeeping/AI fields a channel manager has no equivalent for.
ALTER TABLE "Room" ALTER COLUMN "base_clean_video_id" DROP NOT NULL,
ALTER COLUMN "last_clean_video_id" DROP NOT NULL,
ALTER COLUMN "floor_number" DROP NOT NULL,
ALTER COLUMN "area_sqft" DROP NOT NULL,
ALTER COLUMN "ai_clean_score" DROP NOT NULL,
ALTER COLUMN "ai_last_checked_at" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL,
    "provider" "ChannelProvider" NOT NULL DEFAULT 'CLOUDBEDS',
    "externalPropertyId" TEXT NOT NULL,
    "propertyName" TEXT,
    "ownerId" TEXT NOT NULL,
    "status" "ChannelConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "propertyTimezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[],
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelRoomMapping" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalRoomTypeId" TEXT NOT NULL,
    "externalRatePlanId" TEXT,
    "roomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelRoomMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelBookingMapping" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalReservationId" TEXT,
    "pushStatus" "ChannelPushStatus" NOT NULL DEFAULT 'PENDING',
    "pushAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastPushedAt" TIMESTAMP(3),
    "lastPushError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelBookingMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelSyncLog" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "kind" "ChannelSyncKind" NOT NULL,
    "outcome" "ChannelSyncOutcome" NOT NULL,
    "eventKey" TEXT,
    "message" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelConnection_status_syncEnabled_idx" ON "ChannelConnection"("status", "syncEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_provider_externalPropertyId_key" ON "ChannelConnection"("provider", "externalPropertyId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRoomMapping_connectionId_externalRoomTypeId_key" ON "ChannelRoomMapping"("connectionId", "externalRoomTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelRoomMapping_roomId_key" ON "ChannelRoomMapping"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelBookingMapping_bookingId_key" ON "ChannelBookingMapping"("bookingId");

-- CreateIndex
CREATE INDEX "ChannelBookingMapping_pushStatus_nextRetryAt_idx" ON "ChannelBookingMapping"("pushStatus", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelSyncLog_eventKey_key" ON "ChannelSyncLog"("eventKey");

-- CreateIndex
CREATE INDEX "ChannelSyncLog_connectionId_createdAt_idx" ON "ChannelSyncLog"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "ChannelSyncLog_kind_outcome_createdAt_idx" ON "ChannelSyncLog"("kind", "outcome", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Hotel_channelConnectionId_externalPropertyId_key" ON "Hotel"("channelConnectionId", "externalPropertyId");

-- AddForeignKey
ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "ChannelConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRoomMapping" ADD CONSTRAINT "ChannelRoomMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelRoomMapping" ADD CONSTRAINT "ChannelRoomMapping_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBookingMapping" ADD CONSTRAINT "ChannelBookingMapping_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelBookingMapping" ADD CONSTRAINT "ChannelBookingMapping_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSyncLog" ADD CONSTRAINT "ChannelSyncLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
