import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { razorpay } from '@/lib/razorpay'
import { sendBookingCancellation } from '@/lib/email'

function dateRange(start: Date, end: Date) {
  const dates: string[] = []
  const startDate = new Date(start)
  startDate.setHours(0, 0, 0, 0)
  const endDate = new Date(end)
  endDate.setHours(0, 0, 0, 0)

  for (const current = new Date(startDate); current <= endDate; current.setDate(current.getDate() + 1)) {
    dates.push(current.toISOString().split('T')[0])
  }
  return dates
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { payment: true, roomSlot: { include: { room: { include: { hotel: true } } } } },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

    const userId = session.user.id
    const role = session.user.role

    if (role !== 'ADMIN' && booking.customerId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!['PENDING', 'CONFIRMED'].includes(booking.status)) {
      return NextResponse.json({ error: 'Cannot cancel this booking' }, { status: 400 })
    }

    let refundAmount: number | undefined
    if (booking.payment?.status === 'SUCCESS' && booking.payment.providerPaymentId) {
      try {
        await razorpay.payments.refund(booking.payment.providerPaymentId, {
          amount: Math.round(booking.totalAmount * 100),
        })
        refundAmount = booking.totalAmount
        await prisma.payment.update({ where: { bookingId: id }, data: { status: 'REFUNDED' } })
      } catch (refundErr) {
        console.error('Refund failed:', refundErr)
      }
    }

    await prisma.$transaction([
      prisma.booking.update({ where: { id }, data: { status: 'CANCELLED' } }),
      prisma.roomSlot.updateMany({
        where: booking.roomSlot.slotType === 'FULLDAY'
          ? {
              roomId: booking.roomSlot.roomId,
              date: { in: dateRange(booking.checkIn, booking.checkOut) },
              slotType: 'FULLDAY',
              startTime: booking.roomSlot.startTime,
            }
          : { id: booking.roomSlotId },
        data: { isBooked: false },
      }),
    ])

    try {
      await sendBookingCancellation(booking, refundAmount)
    } catch (e) { console.error('Cancel email error:', e) }

    return NextResponse.json({ success: true, refundAmount })
  } catch {
    return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 })
  }
}
