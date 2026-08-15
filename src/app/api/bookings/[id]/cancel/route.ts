import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getRazorpay } from '@/lib/razorpay'
import { sendBookingCancellation } from '@/lib/email'
import { requireApiPermission } from '@/lib/api-rbac'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'

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
    const permissionError = requireApiPermission(session, PERMISSIONS.CUSTOMER_ACCESS)
    if (permissionError) return permissionError

    const { id } = await params
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { payment: true, roomSlot: { include: { room: { include: { hotel: true } } } } },
    })

    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

    const userId = session!.user.id
    const role = session!.user.role

    if (!hasPermission(role, PERMISSIONS.ADMIN_ACCESS) && booking.customerId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!['PENDING', 'CONFIRMED'].includes(booking.status)) {
      return NextResponse.json({ error: 'Cannot cancel this booking' }, { status: 400 })
    }

    if (booking.payment?.status === 'REFUND_PENDING') {
      return NextResponse.json({ error: 'Your refund is already being processed. Please contact support if this remains unchanged.' }, { status: 409 })
    }

    let refundAmount: number | undefined
    if (booking.payment?.status === 'SUCCESS') {
      if (booking.payment.provider !== 'RAZORPAY' || !booking.payment.providerPaymentId) {
        return NextResponse.json({ error: 'This payment needs support assistance before cancellation.' }, { status: 409 })
      }
      const claimed = await prisma.payment.updateMany({
        where: { id: booking.payment.id, status: 'SUCCESS' },
        data: { status: 'REFUND_PENDING' },
      })
      if (claimed.count !== 1) {
        return NextResponse.json({ error: 'Payment state changed. Refresh and try again.' }, { status: 409 })
      }
      try {
        const razorpay = getRazorpay()
        const refund = await razorpay.payments.refund(booking.payment.providerPaymentId, {
          amount: Math.round(booking.payment.amount * 100),
        })
        refundAmount = booking.payment.amount
        await prisma.payment.update({ where: { bookingId: id }, data: { status: 'REFUNDED', providerRefundId: refund.id, refundedAt: new Date() } })
      } catch (refundErr) {
        console.error('Refund failed:', refundErr)
        await prisma.payment.updateMany({ where: { id: booking.payment.id, status: 'REFUND_PENDING' }, data: { status: 'SUCCESS' } })
        return NextResponse.json({ error: 'The refund could not be confirmed. Your booking remains active.' }, { status: 502 })
      }
    } else if (booking.payment?.status === 'REFUNDED') {
      refundAmount = booking.payment.amount
    }

    const cancelledAt = new Date()
    await prisma.$transaction(async tx => {
      const changed = await tx.booking.updateMany({
        where: { id, status: { in: ['PENDING', 'CONFIRMED'] } },
        data: { status: 'CANCELLED', cancelledAt, cancellationReason: 'Cancelled by customer' },
      })
      if (changed.count !== 1) throw new Error('Booking state changed')
      if (booking.payment?.status === 'PENDING') {
        await tx.payment.updateMany({ where: { id: booking.payment.id, status: 'PENDING' }, data: { status: 'FAILED' } })
      }
      await tx.roomSlot.updateMany({
        where: booking.roomSlot.slotType === 'FULLDAY'
          ? {
              roomId: booking.roomSlot.roomId,
              date: { in: dateRange(booking.checkIn, booking.checkOut) },
              slotType: 'FULLDAY',
              startTime: booking.roomSlot.startTime,
            }
          : { id: booking.roomSlotId },
        data: { isBooked: false },
      })
    })

    try {
      await sendBookingCancellation(booking, refundAmount)
    } catch (e) { console.error('Cancel email error:', e) }

    return NextResponse.json({ success: true, refundAmount })
  } catch {
    return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 })
  }
}
