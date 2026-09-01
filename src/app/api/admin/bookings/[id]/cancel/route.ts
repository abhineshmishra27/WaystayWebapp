import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { sendBookingCancellation } from '@/lib/email'
import { requireApiPermission } from '@/lib/api-rbac'
import { PERMISSIONS } from '@/lib/rbac'
import { lockRoomInventory, releaseBookingSlots } from '@/lib/booking-inventory-db'
import { canCancelBooking } from '@/lib/booking-cancellation'
import { moneyToNumber } from '@/lib/money'
import { initiateRazorpayRefund, RazorpayRefundPersistenceError, recordPaymentEvent } from '@/lib/payments'

const schema = z.object({
  reason: z.string().trim().min(5).max(500),
  confirmation: z.literal('CANCEL_BOOKING'),
}).strict()

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.BOOKING_MANAGE)
  if (permissionError) return permissionError

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Explicit confirmation and a reason of at least 5 characters are required.' }, { status: 400 })
  }

  const { id } = await params
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      payment: true,
      roomSlot: { include: { room: { include: { hotel: true } } } },
    },
  })

  if (!booking) return NextResponse.json({ error: 'Booking not found.' }, { status: 404 })
  if (!['PENDING', 'CONFIRMED'].includes(booking.status)) {
    return NextResponse.json({ error: `A ${booking.status.toLowerCase()} booking cannot be cancelled.` }, { status: 409 })
  }
  const cancellationRequestedAt = new Date()
  if (!canCancelBooking(booking, cancellationRequestedAt)) {
    return NextResponse.json({ error: 'This stay has already started and can no longer be cancelled.' }, { status: 409 })
  }

  let refundAmount: number | undefined
  let refundId = booking.payment?.providerRefundId ?? undefined
  const payment = booking.payment
  let resultingPaymentStatus = payment?.status ?? 'PAY_AT_HOTEL'

  if (payment?.status === 'REFUND_PENDING') {
    return NextResponse.json({ error: 'A refund is already being processed. Verify it in Razorpay before retrying.' }, { status: 409 })
  }
  if (payment?.status === 'REFUND_FAILED') {
    return NextResponse.json({ error: 'A previous refund failed. Resolve it in Razorpay before cancelling this booking.' }, { status: 409 })
  }

  if (payment?.status === 'SUCCESS') {
    if (payment.provider !== 'RAZORPAY') {
      return NextResponse.json({ error: `${payment.provider} refunds are not supported by this admin workflow.` }, { status: 409 })
    }
    if (!payment.providerPaymentId) {
      return NextResponse.json({ error: 'The captured payment has no provider payment ID. Resolve it before cancelling.' }, { status: 409 })
    }

    const claimed = await prisma.payment.updateMany({
      where: { id: payment.id, status: 'SUCCESS' },
      data: { status: 'REFUND_PENDING' },
    })
    if (claimed.count === 0) {
      return NextResponse.json({ error: 'The payment state changed. Refresh the booking before retrying.' }, { status: 409 })
    }
    await prisma.paymentEvent.create({
      data: { paymentId: payment.id, fromStatus: 'SUCCESS', toStatus: 'REFUND_PENDING', actorType: 'ADMIN', actorId: session!.user.id },
    })

    try {
      const refund = await initiateRazorpayRefund({
        bookingId: booking.id,
        paymentRecordId: payment.id,
        providerPaymentId: payment.providerPaymentId,
        amount: payment.amount,
        actorType: 'ADMIN',
        actorId: session!.user.id,
      })
      refundId = refund.id
      refundAmount = moneyToNumber(payment.amount)
      resultingPaymentStatus = refund.status
      if (refund.status === 'REFUND_FAILED') {
        return NextResponse.json({ error: 'Razorpay could not process the refund. The booking remains active and needs support review.' }, { status: 502 })
      }
    } catch (error) {
      console.error('Administrative refund failed:', error)
      if (error instanceof RazorpayRefundPersistenceError) {
        return NextResponse.json({
          error: `Razorpay accepted refund ${error.refundId}, but WayStayy could not save the final state. Leave the booking active and reconcile this refund in Razorpay.`,
        }, { status: 502 })
      }
      await prisma.payment.updateMany({
        where: { id: payment.id, status: 'REFUND_PENDING' },
        data: { status: 'SUCCESS' },
      })
      await prisma.paymentEvent.create({
        data: {
          paymentId: payment.id,
          fromStatus: 'REFUND_PENDING',
          toStatus: 'SUCCESS',
          actorType: 'ADMIN',
          actorId: session!.user.id,
          metadata: { error: error instanceof Error ? error.message : 'Unknown refund error' },
        },
      })
      return NextResponse.json({ error: 'Razorpay did not confirm the refund. The booking remains active.' }, { status: 502 })
    }
  } else if (payment?.status === 'REFUNDED') {
    refundAmount = moneyToNumber(payment.amount)
  }

  const cancelledAt = cancellationRequestedAt
  try {
    await prisma.$transaction(async tx => {
      await lockRoomInventory(tx, booking.roomSlot.roomId)
      const bookingUpdate = await tx.booking.updateMany({
        where: { id, status: { in: ['PENDING', 'CONFIRMED'] }, checkIn: { gt: cancellationRequestedAt } },
        data: {
          status: 'CANCELLED',
          cancelledAt,
          cancellationReason: parsed.data.reason,
        },
      })
      if (bookingUpdate.count !== 1) throw new Error('BOOKING_STATE_CHANGED')

      if (payment?.status === 'PENDING') {
        await tx.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } })
        resultingPaymentStatus = 'FAILED'
        await recordPaymentEvent(tx, {
          paymentId: payment.id,
          fromStatus: 'PENDING',
          toStatus: 'FAILED',
          actorType: 'ADMIN',
          actorId: session!.user.id,
        })
      }

      await releaseBookingSlots(tx, booking)

      await tx.auditLog.create({
        data: {
          adminId: session!.user.id,
          action: 'BOOKING_CANCELLED_BY_ADMIN',
          targetType: 'Booking',
          targetId: booking.id,
          hotelId: booking.roomSlot.room.hotel.id,
          metadata: {
            before: { bookingStatus: booking.status, paymentStatus: payment?.status ?? 'PAY_AT_HOTEL' },
            after: {
              bookingStatus: 'CANCELLED',
              paymentStatus: resultingPaymentStatus,
              refundId: refundId ?? null,
              cancelledAt: cancelledAt.toISOString(),
            },
            reason: parsed.data.reason,
            customerId: booking.customerId,
          },
        },
      })
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'BOOKING_STATE_CHANGED') {
      return NextResponse.json({ error: 'The booking state changed while cancellation was being processed. Refresh before retrying.' }, { status: 409 })
    }
    console.error('Administrative cancellation finalization failed:', error)
    return NextResponse.json({ error: 'The refund state was saved, but cancellation finalization needs attention. Retry this booking.' }, { status: 500 })
  }

  try {
    await sendBookingCancellation(booking, refundAmount)
  } catch (error) {
    console.error('Administrative cancellation email failed:', error)
  }

  return NextResponse.json({
    success: true,
    booking: { id: booking.id, status: 'CANCELLED', cancelledAt: cancelledAt.toISOString() },
    refund: refundAmount ? { amount: refundAmount, id: refundId } : null,
  })
}
