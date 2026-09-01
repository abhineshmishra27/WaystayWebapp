import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sendBookingConfirmation } from '@/lib/email'
import { failPendingRazorpayPayment, finalizeRazorpayPayment } from '@/lib/payments'
import { getRazorpay } from '@/lib/razorpay'

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
          try {
            await sendBookingConfirmation(result.booking)
          } catch (emailError) {
            console.error(`Confirmation email failed for reconciled booking ${booking.id}:`, emailError)
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
      console.error(`Failed to expire stale booking ${booking.id}:`, error)
    }
  }

  return NextResponse.json({ checked: staleBookings.length, confirmed, retained, expired, failed, expiryMinutes })
}
