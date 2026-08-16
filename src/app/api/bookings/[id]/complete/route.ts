import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendReviewNudge } from '@/lib/email'
import { requireApiPermission } from '@/lib/api-rbac'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'
import { lockRoomInventory, releaseBookingSlots } from '@/lib/booking-inventory-db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.OWNER_BOOKINGS_MANAGE)
    if (permissionError) return permissionError

    const { id } = await params
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { roomSlot: { include: { room: { include: { hotel: true } } } } },
    })
    if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!hasPermission(session!.user.role, PERMISSIONS.ADMIN_ACCESS) && booking.roomSlot.room.hotel.ownerId !== session!.user.id) {
      return NextResponse.json({ error: 'You cannot manage this booking.' }, { status: 403 })
    }

    if (booking.status !== 'CONFIRMED') {
      return NextResponse.json({ error: 'Only confirmed bookings can be completed' }, { status: 400 })
    }

    await prisma.$transaction(async tx => {
      await lockRoomInventory(tx, booking.roomSlot.roomId)
      const changed = await tx.booking.updateMany({ where: { id, status: 'CONFIRMED' }, data: { status: 'COMPLETED' } })
      if (changed.count !== 1) throw new Error('Booking state changed')
      await releaseBookingSlots(tx, booking)
    })

    setTimeout(async () => {
      try {
        const hotelName = booking.roomSlot?.room?.hotel?.name || 'WayStayy'
        await sendReviewNudge(booking, hotelName)
      } catch (e) { console.error('Review nudge error:', e) }
    }, 2 * 60 * 60 * 1000)

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to complete booking' }, { status: 500 })
  }
}
