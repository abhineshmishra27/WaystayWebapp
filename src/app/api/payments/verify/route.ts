import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rate-limit'
import { sendBookingConfirmation } from '@/lib/email'
import crypto from 'crypto'
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

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET as string)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex')

    if (expectedSignature !== razorpaySignature) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 400 })
    }

    await prisma.$transaction([
      prisma.payment.update({
        where: { bookingId },
        data: { providerPaymentId: razorpayPaymentId, status: 'SUCCESS' },
      }),
      prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'CONFIRMED' },
      }),
    ])

    try {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { roomSlot: { include: { room: { include: { hotel: true } } } } },
      })
      if (booking) await sendBookingConfirmation(booking)
    } catch (emailErr) {
      console.error('Email error (non-blocking):', emailErr)
    }

    return NextResponse.json({ success: true, bookingId })
  } catch (error) {
    console.error('Payment verify error:', error)
    return NextResponse.json({ error: 'Payment verification failed' }, { status: 500 })
  }
}
