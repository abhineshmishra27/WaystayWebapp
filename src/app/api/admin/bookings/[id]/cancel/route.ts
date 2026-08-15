import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getRazorpay } from '@/lib/razorpay'
import { sendBookingCancellation } from '@/lib/email'
import { requireApiPermission } from '@/lib/api-rbac'
import { PERMISSIONS } from '@/lib/rbac'

const schema = z.object({
  reason: z.string().trim().min(5).max(500),
  confirmation: z.literal('CANCEL_BOOKING'),
}).strict()

function dateRange(start: Date, end: Date) {
  const dates: string[] = []
  const current = new Date(start)
  current.setHours(0, 0, 0, 0)
  const last = new Date(end)
  last.setHours(0, 0, 0, 0)

  while (current <= last) {
    const year = current.getFullYear()
    const month = String(current.getMonth() + 1).padStart(2, '0')
    const day = String(current.getDate()).padStart(2, '0')
    dates.push(`${year}-${month}-${day}`)
    current.setDate(current.getDate() + 1)
  }
  return dates
}

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

  let refundAmount: number | undefined
  let refundId = booking.payment?.providerRefundId ?? undefined
  const payment = booking.payment

  if (payment?.status === 'REFUND_PENDING') {
    return NextResponse.json({ error: 'A refund is already being processed. Verify it in Razorpay before retrying.' }, { status: 409 })
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

    try {
      const refund = await getRazorpay().payments.refund(payment.providerPaymentId, {
        amount: Math.round(payment.amount * 100),
        notes: { bookingId: booking.id, initiatedBy: session!.user.id },
      })
      refundId = refund.id
      refundAmount = payment.amount
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'REFUNDED', providerRefundId: refund.id, refundedAt: new Date() },
      })
    } catch (error) {
      console.error('Administrative refund failed:', error)
      await prisma.payment.updateMany({
        where: { id: payment.id, status: 'REFUND_PENDING' },
        data: { status: 'SUCCESS' },
      })
      return NextResponse.json({ error: 'Razorpay did not confirm the refund. The booking remains active.' }, { status: 502 })
    }
  } else if (payment?.status === 'REFUNDED') {
    refundAmount = payment.amount
  }

  const cancelledAt = new Date()
  try {
    await prisma.$transaction(async tx => {
      const bookingUpdate = await tx.booking.updateMany({
        where: { id, status: { in: ['PENDING', 'CONFIRMED'] } },
        data: {
          status: 'CANCELLED',
          cancelledAt,
          cancellationReason: parsed.data.reason,
        },
      })
      if (bookingUpdate.count !== 1) throw new Error('BOOKING_STATE_CHANGED')

      if (payment?.status === 'PENDING') {
        await tx.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } })
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
              paymentStatus: payment?.status === 'SUCCESS' || payment?.status === 'REFUNDED' ? 'REFUNDED' : payment?.status === 'PENDING' ? 'FAILED' : payment?.status ?? 'PAY_AT_HOTEL',
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
