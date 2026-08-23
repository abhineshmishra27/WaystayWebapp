UPDATE "Booking" AS booking
SET "checkOut" = booking."checkOut" + INTERVAL '1 day'
FROM "RoomSlot" AS slot
WHERE booking."roomSlotId" = slot."id"
  AND slot."slotType" = 'FULLDAY'
  AND booking."checkOut" - booking."checkIn" < (booking."totalHours" - 1) * INTERVAL '1 hour';
