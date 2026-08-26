ALTER TABLE "Room"
ADD COLUMN "inventoryCount" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Room"
ADD CONSTRAINT "Room_inventoryCount_check" CHECK ("inventoryCount" > 0);
