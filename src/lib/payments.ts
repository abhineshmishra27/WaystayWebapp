import { prisma } from '@/lib/db'
import { getRazorpay } from '@/lib/razorpay'

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
    const expectedAmount = Math.round(booking.payment.amount * 100)

    if (payment.order_id !== orderId) throw new Error('Payment order mismatch')
    if (Number(payment.amount) !== expectedAmount) throw new Error('Payment amount mismatch')
    if (payment.currency !== booking.payment.currency) throw new Error('Payment currency mismatch')
    if (payment.status !== 'captured' || !payment.captured) {
      throw new Error('Payment has not been captured')
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
}: {
  bookingId?: string
  orderId?: string
  paymentId?: string
  customerId?: string
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
    await tx.roomSlot.updateMany({
      where: payment.booking.roomSlot.slotType === 'FULLDAY'
        ? {
            roomId: payment.booking.roomSlot.roomId,
            date: { in: dateRange(payment.booking.checkIn, payment.booking.checkOut) },
            slotType: 'FULLDAY',
            startTime: payment.booking.roomSlot.startTime,
          }
        : { id: payment.booking.roomSlotId },
      data: { isBooked: false },
    })
    return true
  })
}
