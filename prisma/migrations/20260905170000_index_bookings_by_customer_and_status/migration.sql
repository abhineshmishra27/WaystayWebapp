-- Booking had only a (roomSlotId, status) index. The customer's own booking list and
-- the stale-payment cron both scanned the whole table.
CREATE INDEX "Booking_customerId_status_createdAt_idx"
ON "Booking"("customerId", "status", "createdAt");

CREATE INDEX "Booking_status_createdAt_idx"
ON "Booking"("status", "createdAt");
