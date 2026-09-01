import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { validateWebhookSignature } from 'razorpay/dist/utils/razorpay-utils'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sendBookingConfirmation, sendRefundFailedAdminAlert } from '@/lib/email'
import { finalizeRazorpayPayment, recordPaymentEvent } from '@/lib/payments'

interface WebhookPayment {
  id?: string
  order_id?: string
}

interface WebhookRefund {
  id?: string
  payment_id?: string
  status?: string
  notes?: Record<string, unknown>
}

interface WebhookBody {
  event?: string
  payload?: {
    payment?: { entity?: WebhookPayment }
    refund?: { entity?: WebhookRefund }
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Webhook is not configured' }, { status: 503 })
  }

  const signature = req.headers.get('x-razorpay-signature')
  const providerEventId = req.headers.get('x-razorpay-event-id')
  const rawBody = await req.text()
  if (!signature || !validateWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
  }

  const body = JSON.parse(rawBody) as WebhookBody
  const payloadHash = createHash('sha256').update(rawBody).digest('hex')

  let webhookEvent: { id: string }
  try {
    webhookEvent = await prisma.webhookEvent.create({
      data: {
        providerEventId,
        eventType: body.event ?? 'unknown',
        payloadHash,
        payload: body as unknown as Prisma.InputJsonValue,
        outcome: 'received',
      },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Razorpay redelivered an event ID (or an identical fallback payload) we already handled.
      return NextResponse.json({ received: true, duplicate: true })
    }
    throw error
  }

  if (body.event === 'refund.processed' || body.event === 'refund.failed') {
    await handleRefundEvent(body.event, body.payload?.refund?.entity, webhookEvent.id)
    return NextResponse.json({ received: true })
  }

  const payment = body.payload?.payment?.entity
  if (!payment?.id || !payment.order_id) {
    await prisma.webhookEvent.update({ where: { id: webhookEvent.id }, data: { outcome: 'ignored' } })
    return NextResponse.json({ received: true })
  }

  const storedPayment = await prisma.payment.findFirst({
    where: { providerOrderId: payment.order_id, provider: 'RAZORPAY' },
    select: { id: true, bookingId: true, status: true },
  })
  if (!storedPayment) {
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { outcome: 'ignored', errorMessage: 'No matching payment found for this order' },
    })
    return NextResponse.json({ received: true })
  }

  if (body.event === 'payment.captured' || body.event === 'order.paid') {
    try {
      const result = await finalizeRazorpayPayment({
        bookingId: storedPayment.bookingId,
        orderId: payment.order_id,
        paymentId: payment.id,
      })
      await prisma.webhookEvent.update({ where: { id: webhookEvent.id }, data: { outcome: 'processed' } })
      if (result.newlyConfirmed) {
        try {
          await sendBookingConfirmation(result.booking)
        } catch (emailError) {
          console.error('Webhook confirmation email error:', emailError)
        }
      }
    } catch (error) {
      console.error('Razorpay webhook finalization error:', error)
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { outcome: 'error', errorMessage: error instanceof Error ? error.message : 'Unknown error' },
      })
      return NextResponse.json({ error: 'Payment finalization failed' }, { status: 500 })
    }
  } else if (body.event === 'payment.failed') {
    // A Razorpay order can have multiple attempts. Keep inventory reserved so Checkout
    // can retry; the verified expiry job releases it if no attempt is eventually captured.
    if (storedPayment.status === 'PENDING') {
      await prisma.paymentEvent.create({
        data: {
          paymentId: storedPayment.id,
          fromStatus: 'PENDING',
          toStatus: 'PENDING',
          actorType: 'WEBHOOK',
          providerEventId: payment.id,
          metadata: { attemptFailed: true, orderId: payment.order_id },
        },
      })
    }
    await prisma.webhookEvent.update({ where: { id: webhookEvent.id }, data: { outcome: 'processed' } })
  } else {
    await prisma.webhookEvent.update({ where: { id: webhookEvent.id }, data: { outcome: 'ignored' } })
  }

  return NextResponse.json({ received: true })
}

async function handleRefundEvent(event: string, refund: WebhookRefund | undefined, webhookEventId: string) {
  if (!refund?.id || !refund.payment_id) {
    await prisma.webhookEvent.update({ where: { id: webhookEventId }, data: { outcome: 'ignored' } })
    return
  }

  const payment = await prisma.payment.findFirst({
    where: {
      provider: 'RAZORPAY',
      OR: [{ providerPaymentId: refund.payment_id }, { providerRefundId: refund.id }],
    },
    include: {
      booking: {
        select: {
          guestName: true,
          guestEmail: true,
          roomSlot: { select: { room: { select: { hotel: { select: { name: true } } } } } },
        },
      },
    },
  })

  if (!payment) {
    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: { outcome: 'ignored', errorMessage: 'No matching payment found for this refund' },
    })
    return
  }

  if (event === 'refund.processed') {
    if (payment.status === 'REFUND_PENDING') {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'REFUNDED', providerRefundId: refund.id, refundedAt: new Date() },
        })
        await recordPaymentEvent(tx, {
          paymentId: payment.id,
          fromStatus: 'REFUND_PENDING',
          toStatus: 'REFUNDED',
          actorType: 'WEBHOOK',
          providerEventId: refund.id,
        })
      })
    } else if (payment.status !== 'REFUNDED') {
      // Confirmation arrived while our own record was in an unexpected state — keep the trail without silently overwriting it.
      await prisma.paymentEvent.create({
        data: {
          paymentId: payment.id,
          fromStatus: payment.status,
          toStatus: payment.status,
          actorType: 'WEBHOOK',
          providerEventId: refund.id,
          metadata: { note: 'refund.processed received while payment was not REFUND_PENDING', currentStatus: payment.status },
        },
      })
    }
    await prisma.webhookEvent.update({ where: { id: webhookEventId }, data: { outcome: 'processed' } })
    return
  }

  // refund.failed — a refund we believed succeeded (or was in flight) actually failed at the bank.
  if (payment.status === 'REFUND_PENDING' || payment.status === 'REFUNDED') {
    const previousStatus = payment.status
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'REFUND_FAILED', providerRefundId: refund.id },
      })
      await recordPaymentEvent(tx, {
        paymentId: payment.id,
        fromStatus: previousStatus,
        toStatus: 'REFUND_FAILED',
        actorType: 'WEBHOOK',
        providerEventId: refund.id,
        metadata: { refundStatus: refund.status ?? null },
      })
    })

    console.error(`Razorpay refund failed for payment ${payment.id} (booking ${payment.bookingId}) — was ${previousStatus}`)
    try {
      await sendRefundFailedAdminAlert({
        bookingId: payment.bookingId,
        guestName: payment.booking.guestName,
        guestEmail: payment.booking.guestEmail,
        hotelName: payment.booking.roomSlot.room.hotel.name,
        amount: payment.amount,
        providerPaymentId: payment.providerPaymentId,
        providerRefundId: refund.id,
        reason: refund.status ?? null,
      })
    } catch (emailError) {
      console.error('Refund-failed admin alert email error:', emailError)
    }
  }

  await prisma.webhookEvent.update({ where: { id: webhookEventId }, data: { outcome: 'processed' } })
}
