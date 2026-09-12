import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { bookingCoveredDates, type ActiveBookingWindow, type InventoryHold } from '@/lib/booking-inventory'

type PrismaReader = Prisma.TransactionClient | typeof prisma

/**
 * Channel-held units for the given rooms and dates, keyed by room id. Rooms with no
 * holds are absent from the map, so callers should default to an empty array.
 */
export async function loadChannelHolds(
  client: PrismaReader,
  roomIds: string[],
  dates: string[],
): Promise<Map<string, InventoryHold[]>> {
  const holdsByRoom = new Map<string, InventoryHold[]>()
  if (roomIds.length === 0 || dates.length === 0) return holdsByRoom

  const rows = await client.channelInventoryHold.findMany({
    where: { roomId: { in: roomIds }, date: { in: dates }, unitsHeld: { gt: 0 } },
    select: { roomId: true, date: true, unitsHeld: true },
  })

  for (const row of rows) {
    const existing = holdsByRoom.get(row.roomId)
    const hold: InventoryHold = { date: row.date, unitsHeld: row.unitsHeld }
    if (existing) existing.push(hold)
    else holdsByRoom.set(row.roomId, [hold])
  }
  return holdsByRoom
}

export async function loadChannelHoldsForRoom(client: PrismaReader, roomId: string, dates: string[]) {
  const holdsByRoom = await loadChannelHolds(client, [roomId], dates)
  return holdsByRoom.get(roomId) ?? []
}

export async function lockRoomInventory(tx: Prisma.TransactionClient, roomId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`waystay-room:${roomId}`}))::text AS lock_result`
}

export async function releaseBookingSlots(
  tx: Prisma.TransactionClient,
  booking: ActiveBookingWindow & { roomSlotId: string; roomSlot: ActiveBookingWindow['roomSlot'] & { roomId: string } },
) {
  if (booking.roomSlot.slotType !== 'FULLDAY') {
    await tx.roomSlot.updateMany({ where: { id: booking.roomSlotId }, data: { isBooked: false } })
    return
  }

  await tx.roomSlot.updateMany({
    where: {
      roomId: booking.roomSlot.roomId,
      date: { in: bookingCoveredDates(booking) },
      slotType: 'FULLDAY',
      startTime: booking.roomSlot.startTime,
      endTime: booking.roomSlot.endTime,
    },
    data: { isBooked: false },
  })
}
