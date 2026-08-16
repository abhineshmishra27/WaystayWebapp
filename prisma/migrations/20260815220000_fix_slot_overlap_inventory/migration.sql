DROP INDEX IF EXISTS "Booking_roomSlotId_key";

CREATE INDEX "Booking_roomSlotId_status_idx" ON "Booking"("roomSlotId", "status");
