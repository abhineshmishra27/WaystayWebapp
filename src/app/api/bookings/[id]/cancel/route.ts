import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendBookingCancellation } from '@/lib/email'
import { requireApiPermission } from '@/lib/api-rbac'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'
import { lockRoomInventory, releaseBookingSlots } from '@/lib/booking-inventory-db'
import { canCancelBooking } from '@/lib/booking-cancellation'
import { moneyToNumber } from '@/lib/money'
import { initiateRazorpayRefund, RazorpayRefundPersistenceError, recordPaymentEvent } from '@/lib/payments'

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

    const cancellationRequestedAt = new Date()
    if (!['PENDING', 'CONFIRMED'].includes(booking.status)) {
      return NextResponse.json({ error: 'Cannot cancel this booking' }, { status: 400 })
    }
    if (!canCancelBooking(booking, cancellationRequestedAt)) {
      return NextResponse.json({ error: 'This stay has already started and can no longer be cancelled.' }, { status: 409 })
    }

    if (booking.payment?.status === 'REFUND_PENDING') {
      return NextResponse.json({ error: 'Your refund is already being processed. Please contact support if this remains unchanged.' }, { status: 409 })
    }
    if (booking.payment?.status === 'REFUND_FAILED') {
      return NextResponse.json({ error: 'A previous refund failed. Please contact support before cancelling this booking.' }, { status: 409 })
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
      const refundActorType = role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER'
      await prisma.paymentEvent.create({
        data: { paymentId: booking.payment.id, fromStatus: 'SUCCESS', toStatus: 'REFUND_PENDING', actorType: refundActorType, actorId: userId },
      })
      try {
        const refund = await initiateRazorpayRefund({
          bookingId: booking.id,
          paymentRecordId: booking.payment.id,
          providerPaymentId: booking.payment.providerPaymentId,
          amount: booking.payment.amount,
          actorType: refundActorType,
          actorId: userId,
        })
        refundAmount = moneyToNumber(booking.payment.amount)
        if (refund.status === 'REFUND_FAILED') {
          return NextResponse.json({ error: 'Razorpay could not process the refund. Your booking remains active; please contact support.' }, { status: 502 })
        }
      } catch (refundErr) {
        console.error('Refund failed:', refundErr)
        if (refundErr instanceof RazorpayRefundPersistenceError) {
          return NextResponse.json({
            error: `Razorpay accepted refund ${refundErr.refundId}, but confirmation is still pending. The booking remains active; please contact support.`,
          }, { status: 502 })
        }
        await prisma.payment.updateMany({ where: { id: booking.payment.id, status: 'REFUND_PENDING' }, data: { status: 'SUCCESS' } })
        await prisma.paymentEvent.create({
          data: {
            paymentId: booking.payment.id,
            fromStatus: 'REFUND_PENDING',
            toStatus: 'SUCCESS',
            actorType: refundActorType,
            actorId: userId,
            metadata: { error: refundErr instanceof Error ? refundErr.message : 'Unknown refund error' },
          },
        })
        return NextResponse.json({ error: 'The refund could not be confirmed. Your booking remains active.' }, { status: 502 })
      }
    } else if (booking.payment?.status === 'REFUNDED') {
      refundAmount = moneyToNumber(booking.payment.amount)
    }

    const cancelledAt = cancellationRequestedAt
    await prisma.$transaction(async tx => {
      await lockRoomInventory(tx, booking.roomSlot.roomId)
      const changed = await tx.booking.updateMany({
        where: { id, status: { in: ['PENDING', 'CONFIRMED'] }, checkIn: { gt: cancellationRequestedAt } },
        data: { status: 'CANCELLED', cancelledAt, cancellationReason: 'Cancelled by customer' },
      })
      if (changed.count !== 1) throw new Error('BOOKING_CANCELLATION_NOT_ALLOWED')
      if (booking.payment?.status === 'PENDING') {
        await tx.payment.updateMany({ where: { id: booking.payment.id, status: 'PENDING' }, data: { status: 'FAILED' } })
        await recordPaymentEvent(tx, {
          paymentId: booking.payment.id,
          fromStatus: 'PENDING',
          toStatus: 'FAILED',
          actorType: role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER',
          actorId: userId,
        })
      }
      await releaseBookingSlots(tx, booking)
    })

    try {
      await sendBookingCancellation(booking, refundAmount)
    } catch (e) { console.error('Cancel email error:', e) }

    return NextResponse.json({ success: true, refundAmount })
  } catch (error) {
    if (error instanceof Error && error.message === 'BOOKING_CANCELLATION_NOT_ALLOWED') {
      return NextResponse.json({ error: 'This booking can no longer be cancelled. Refresh your bookings.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 })
  }
}
