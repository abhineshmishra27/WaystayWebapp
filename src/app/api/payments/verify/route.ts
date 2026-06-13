import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { sendBookingConfirmation } from '@/lib/email'
import { finalizeRazorpayPayment, getPendingRazorpayBooking } from '@/lib/payments'
import { validatePaymentVerification } from 'razorpay/dist/utils/razorpay-utils'
import { z } from 'zod'

const schema = z.object({
  razorpayPaymentId: z.string(),
  razorpayOrderId: z.string(),
  razorpaySignature: z.string(),
  bookingId: z.string(),
})

function isRazorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_KEY_ID?.startsWith('rzp_'))
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown'
    const { success } = rateLimit(`payment:${ip}`, 20, 60 * 60 * 1000)
    if (!success) {
      return NextResponse.json({ error: 'Too many payment verification attempts.' }, { status: 429 })
    }

    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const { razorpayPaymentId, razorpayOrderId, razorpaySignature, bookingId } = parsed.data
    if (!isRazorpayConfigured()) {
      return NextResponse.json({ error: 'Payment gateway credentials are not configured' }, { status: 503 })
    }

    const booking = await getPendingRazorpayBooking(bookingId, session.user.id)
    if (!booking?.payment) {
      return NextResponse.json({ error: 'Payment record not found' }, { status: 404 })
    }
    if (booking.payment.providerOrderId !== razorpayOrderId) {
      return NextResponse.json({ error: 'Payment order does not match this booking' }, { status: 400 })
    }

    const signatureValid = validatePaymentVerification(
      { order_id: booking.payment.providerOrderId, payment_id: razorpayPaymentId },
      razorpaySignature,
      process.env.RAZORPAY_KEY_SECRET as string
    )
    if (!signatureValid) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 })
    }

    const result = await finalizeRazorpayPayment({
      bookingId,
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      customerId: session.user.id,
    })

    try {
      if (result.newlyConfirmed) await sendBookingConfirmation(result.booking)
    } catch (emailErr) {
      console.error('Email error (non-blocking):', emailErr)
    }

    return NextResponse.json({ success: true, bookingId })
  } catch (error) {
    console.error('Payment verify error:', error)
    if (
      error instanceof Error &&
      [
        'Payment record not found',
        'Payment order does not match this booking',
        'Payment order mismatch',
        'Payment amount mismatch',
        'Payment currency mismatch',
        'Payment has not been captured',
      ].includes(error.message)
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Payment verification failed' }, { status: 500 })
  }
}
