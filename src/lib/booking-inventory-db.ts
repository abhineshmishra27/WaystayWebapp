import type { Prisma } from '@prisma/client'
import { bookingCoveredDates, type ActiveBookingWindow } from '@/lib/booking-inventory'

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
