import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sendBookingConfirmation } from '@/lib/email'
import { failPendingRazorpayPayment, finalizeRazorpayPayment } from '@/lib/payments'
import { getRazorpay } from '@/lib/razorpay'
import { logger } from '@/lib/logger'
import { notifyChannelOfConfirmedBooking } from '@/lib/channels/sync'

const DEFAULT_EXPIRY_MINUTES = 20

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const configuredMinutes = Number(process.env.PAYMENT_EXPIRY_MINUTES)
  const expiryMinutes = Number.isFinite(configuredMinutes) && configuredMinutes > 0
    ? configuredMinutes
    : DEFAULT_EXPIRY_MINUTES
  const cutoff = new Date(Date.now() - expiryMinutes * 60 * 1000)

  const staleBookings = await prisma.booking.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: cutoff },
      payment: { status: 'PENDING', provider: 'RAZORPAY' },
    },
    select: { id: true, payment: { select: { providerOrderId: true } } },
  })

  let expired = 0
  let confirmed = 0
  let retained = 0
  let failed = 0
  const razorpay = getRazorpay()
  for (const booking of staleBookings) {
    try {
      const orderId = booking.payment?.providerOrderId
      if (!orderId) throw new Error('Pending Razorpay payment has no provider order ID')

      const attempts = await razorpay.orders.fetchPayments(orderId)
      const capturedAttempt = attempts.items.find(attempt => attempt.status === 'captured' && attempt.captured)
      if (capturedAttempt) {
        const result = await finalizeRazorpayPayment({
          bookingId: booking.id,
          orderId,
          paymentId: capturedAttempt.id,
        })
        confirmed++
        if (result.newlyConfirmed) {
          await notifyChannelOfConfirmedBooking(result.booking.id)
          try {
            await sendBookingConfirmation(result.booking)
          } catch (emailError) {
            logger.error('api.cron.expire_stale_payments.confirmation_email_failed', emailError, { bookingId: booking.id })
          }
        }
        continue
      }

      if (attempts.items.some(attempt => attempt.status === 'authorized')) {
        retained++
        continue
      }

      const released = await failPendingRazorpayPayment({ bookingId: booking.id, actorType: 'SYSTEM' })
      if (released) expired++
    } catch (error) {
      failed++
      logger.error('api.cron.expire_stale_payments.booking_expiry_failed', error, { bookingId: booking.id })
    }
  }

  return NextResponse.json({ checked: staleBookings.length, confirmed, retained, expired, failed, expiryMinutes })
}
