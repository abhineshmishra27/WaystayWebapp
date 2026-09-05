-- Inventory a channel partner has sold outside WayStay. Held units reduce a room's
-- effective inventory for that date; RoomSlot."isBooked" is not consulted by the
-- capacity check, so external sales must be blocked here instead.
CREATE TABLE "ChannelInventoryHold" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "unitsHeld" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'CLOUDBEDS',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelInventoryHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelInventoryHold_roomId_date_key"
ON "ChannelInventoryHold"("roomId", "date");

CREATE INDEX "ChannelInventoryHold_date_idx"
ON "ChannelInventoryHold"("date");

ALTER TABLE "ChannelInventoryHold"
ADD CONSTRAINT "ChannelInventoryHold_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
