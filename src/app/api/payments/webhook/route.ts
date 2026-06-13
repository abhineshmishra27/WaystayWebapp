import { NextRequest, NextResponse } from 'next/server'
import { validateWebhookSignature } from 'razorpay/dist/utils/razorpay-utils'
import { prisma } from '@/lib/db'
import { sendBookingConfirmation } from '@/lib/email'
import { failPendingRazorpayPayment, finalizeRazorpayPayment } from '@/lib/payments'

interface WebhookPayment {
  id?: string
  order_id?: string
}

interface WebhookBody {
  event?: string
  payload?: {
    payment?: { entity?: WebhookPayment }
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook is not configured' }, { status: 503 })
  }

  const signature = req.headers.get('x-razorpay-signature')
  const rawBody = await req.text()
  if (!signature || !validateWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }

  const body = JSON.parse(rawBody) as WebhookBody
  const payment = body.payload?.payment?.entity
  if (!payment?.id || !payment.order_id) {
    return NextResponse.json({ received: true })
  }

  const storedPayment = await prisma.payment.findFirst({
    where: { providerOrderId: payment.order_id, provider: 'RAZORPAY' },
    select: { bookingId: true },
  })
  if (!storedPayment) return NextResponse.json({ received: true })

  if (body.event === 'payment.captured' || body.event === 'order.paid') {
    try {
      const result = await finalizeRazorpayPayment({
        bookingId: storedPayment.bookingId,
        orderId: payment.order_id,
        paymentId: payment.id,
      })
      if (result.newlyConfirmed) {
        try {
          await sendBookingConfirmation(result.booking)
        } catch (emailError) {
          console.error('Webhook confirmation email error:', emailError)
        }
      }
    } catch (error) {
      console.error('Razorpay webhook finalization error:', error)
      return NextResponse.json({ error: 'Payment finalization failed' }, { status: 500 })
    }
  }

  if (body.event === 'payment.failed') {
    await failPendingRazorpayPayment({
      bookingId: storedPayment.bookingId,
      orderId: payment.order_id,
      paymentId: payment.id,
    })
  }

  return NextResponse.json({ received: true })
}
