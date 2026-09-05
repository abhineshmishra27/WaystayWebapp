-- Search filters rooms by hotel and stay type in SQL. Room had no index on hotelId at
-- all, so every candidate-hotel batch degraded to a scan of the whole Room table.
CREATE INDEX "Room_hotelId_idx" ON "Room"("hotelId");

CREATE INDEX "Room_hotelId_isActive_available_idx"
ON "Room"("hotelId", "isActive", "available");
