import type { Prisma, PaymentActorType, PaymentStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getRazorpay } from '@/lib/razorpay'
import { lockRoomInventory, releaseBookingSlots } from '@/lib/booking-inventory-db'
import { rupeesToPaise, type MoneyValue } from '@/lib/money'
import { waystayStatusForRazorpayRefund } from '@/lib/razorpay-status'

export class RazorpayRefundPersistenceError extends Error {
  constructor(public readonly refundId: string, cause: unknown) {
    super('Razorpay accepted the refund, but WayStayy could not persist its state', { cause })
    this.name = 'RazorpayRefundPersistenceError'
  }
}

export async function recordPaymentEvent(
  tx: Prisma.TransactionClient,
  params: {
    paymentId: string
    fromStatus: PaymentStatus | null
    toStatus: PaymentStatus
    actorType: PaymentActorType
    actorId?: string | null
    providerEventId?: string | null
    metadata?: Prisma.InputJsonValue
  }
) {
  await tx.paymentEvent.create({
    data: {
      paymentId: params.paymentId,
      fromStatus: params.fromStatus,
      toStatus: params.toStatus,
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      providerEventId: params.providerEventId ?? null,
      metadata: params.metadata,
    },
  })
}

export async function initiateRazorpayRefund({
  bookingId,
  paymentRecordId,
  providerPaymentId,
  amount,
  actorType,
  actorId,
}: {
  bookingId: string
  paymentRecordId: string
  providerPaymentId: string
  amount: MoneyValue
  actorType: Extract<PaymentActorType, 'CUSTOMER' | 'ADMIN'>
  actorId: string
}) {
  const refund = await getRazorpay().payments.refund(providerPaymentId, {
    amount: rupeesToPaise(amount),
    notes: { bookingId, initiatedBy: actorId },
  })
  const nextStatus = waystayStatusForRazorpayRefund(refund.status)

  try {
    await prisma.$transaction(async (tx) => {
      const changed = await tx.payment.updateMany({
        where: { id: paymentRecordId, status: 'REFUND_PENDING' },
        data: {
          status: nextStatus,
          providerRefundId: refund.id,
          refundedAt: nextStatus === 'REFUNDED' ? new Date() : null,
        },
      })
      if (changed.count !== 1) throw new Error('Payment state changed while recording the refund')

      await recordPaymentEvent(tx, {
        paymentId: paymentRecordId,
        fromStatus: 'REFUND_PENDING',
        toStatus: nextStatus,
        actorType,
        actorId,
        providerEventId: refund.id,
        metadata: { providerStatus: refund.status },
      })
    })
  } catch (error) {
    throw new RazorpayRefundPersistenceError(refund.id, error)
  }

  return { id: refund.id, providerStatus: refund.status, status: nextStatus }
}

export async function getPendingRazorpayBooking(bookingId: string, customerId?: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payment: true, roomSlot: true },
  })

  if (!booking || (customerId && booking.customerId !== customerId)) {
    return null
  }

  return booking
}

export async function finalizeRazorpayPayment({
  bookingId,
  orderId,
  paymentId,
  customerId,
}: {
  bookingId: string
  orderId: string
  paymentId: string
  customerId?: string
}) {
  const booking = await getPendingRazorpayBooking(bookingId, customerId)
  if (!booking?.payment || booking.payment.provider !== 'RAZORPAY') {
    throw new Error('Payment record not found')
  }
  if (booking.payment.providerOrderId !== orderId) {
    await prisma.paymentEvent.create({
      data: {
        paymentId: booking.payment.id,
        fromStatus: booking.payment.status,
        toStatus: booking.payment.status,
        actorType: customerId ? 'CUSTOMER' : 'WEBHOOK',
        actorId: customerId ?? null,
        providerEventId: paymentId,
        metadata: { rejected: true, reason: 'Payment order does not match this booking', claimedOrderId: orderId, expectedOrderId: booking.payment.providerOrderId },
      },
    })
    throw new Error('Payment order does not match this booking')
  }
  const alreadyConfirmed =
    booking.payment.status === 'SUCCESS' &&
    booking.payment.providerPaymentId === paymentId &&
    booking.status === 'CONFIRMED'

  let updated = false
  if (!alreadyConfirmed) {
    const razorpay = getRazorpay()
    const payment = await razorpay.payments.fetch(paymentId)
    const expectedAmount = rupeesToPaise(booking.payment.amount)

    const rejectionReason =
      payment.order_id !== orderId ? 'Payment order mismatch'
      : Number(payment.amount) !== expectedAmount ? 'Payment amount mismatch'
      : payment.currency !== booking.payment.currency ? 'Payment currency mismatch'
      : (payment.status !== 'captured' || !payment.captured) ? 'Payment has not been captured'
      : null

    if (rejectionReason) {
      await prisma.paymentEvent.create({
        data: {
          paymentId: booking.payment.id,
          fromStatus: booking.payment.status,
          toStatus: booking.payment.status,
          actorType: customerId ? 'CUSTOMER' : 'WEBHOOK',
          actorId: customerId ?? null,
          providerEventId: paymentId,
          metadata: {
            rejected: true,
            reason: rejectionReason,
            claimedOrderId: orderId,
            providerOrderId: payment.order_id,
            expectedAmountPaise: expectedAmount,
            providerAmountPaise: payment.amount,
            providerCurrency: payment.currency,
            providerStatus: payment.status,
            providerCaptured: payment.captured,
          },
        },
      })
      throw new Error(rejectionReason)
    }

    updated = await prisma.$transaction(async (tx) => {
      const paymentUpdate = await tx.payment.updateMany({
        where: { bookingId, status: 'PENDING' },
        data: { providerPaymentId: paymentId, status: 'SUCCESS' },
      })

      if (paymentUpdate.count === 0) return false

      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CONFIRMED' },
      })

      await recordPaymentEvent(tx, {
        paymentId: booking.payment!.id,
        fromStatus: 'PENDING',
        toStatus: 'SUCCESS',
        actorType: customerId ? 'CUSTOMER' : 'WEBHOOK',
        actorId: customerId ?? null,
        providerEventId: paymentId,
        metadata: { orderId },
      })
      return true
    })
  }

  const confirmedBooking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { roomSlot: { include: { room: { include: { hotel: true } } } } },
  })

  return { booking: confirmedBooking, newlyConfirmed: updated }
}

export async function failPendingRazorpayPayment({
  bookingId,
  orderId,
  paymentId,
  customerId,
  actorType,
}: {
  bookingId?: string
  orderId?: string
  paymentId?: string
  customerId?: string
  actorType?: PaymentActorType
}) {
  const payment = await prisma.payment.findFirst({
    where: {
      ...(bookingId ? { bookingId } : {}),
      ...(orderId ? { providerOrderId: orderId } : {}),
      provider: 'RAZORPAY',
    },
    include: { booking: { include: { roomSlot: true } } },
  })

  if (!payment || (customerId && payment.booking.customerId !== customerId)) {
    return false
  }
  if (payment.status !== 'PENDING' || payment.booking.status !== 'PENDING') {
    return false
  }

  return prisma.$transaction(async (tx) => {
    await lockRoomInventory(tx, payment.booking.roomSlot.roomId)
    const paymentUpdate = await tx.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: {
        status: 'FAILED',
        ...(paymentId ? { providerPaymentId: paymentId } : {}),
      },
    })
    if (paymentUpdate.count === 0) return false

    await tx.booking.update({
      where: { id: payment.bookingId },
      data: { status: 'CANCELLED' },
    })
    await releaseBookingSlots(tx, payment.booking)

    await recordPaymentEvent(tx, {
      paymentId: payment.id,
      fromStatus: 'PENDING',
      toStatus: 'FAILED',
      actorType: actorType ?? (customerId ? 'CUSTOMER' : 'WEBHOOK'),
      actorId: customerId ?? null,
      providerEventId: paymentId ?? null,
    })
    return true
  })
}
