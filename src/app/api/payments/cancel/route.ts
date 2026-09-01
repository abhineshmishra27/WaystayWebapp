import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { sendBookingConfirmation } from '@/lib/email'
import { failPendingRazorpayPayment, finalizeRazorpayPayment, getPendingRazorpayBooking } from '@/lib/payments'
import { getRazorpay } from '@/lib/razorpay'
import { requireApiPermission } from '@/lib/api-rbac'
import { PERMISSIONS } from '@/lib/rbac'

const schema = z.object({
  bookingId: z.string().min(1),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.BOOKING_CREATE)
  if (permissionError) return permissionError

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const booking = await getPendingRazorpayBooking(parsed.data.bookingId, session!.user.id)
  if (!booking?.payment || booking.payment.providerOrderId !== parsed.data.razorpayOrderId) {
    return NextResponse.json({ error: 'Payment record not found' }, { status: 404 })
  }

  const attempts = await getRazorpay().orders.fetchPayments(parsed.data.razorpayOrderId)
  const capturedAttempt = attempts.items.find(attempt => attempt.status === 'captured' && attempt.captured)
  if (capturedAttempt) {
    const result = await finalizeRazorpayPayment({
      bookingId: parsed.data.bookingId,
      orderId: parsed.data.razorpayOrderId,
      paymentId: capturedAttempt.id,
      customerId: session!.user.id,
    })
    if (result.newlyConfirmed) {
      try {
        await sendBookingConfirmation(result.booking)
      } catch (emailError) {
        console.error('Reconciled cancellation confirmation email failed:', emailError)
      }
    }
    return NextResponse.json({ success: true, released: false, confirmed: true })
  }

  if (attempts.items.some(attempt => attempt.status === 'authorized')) {
    return NextResponse.json({ error: 'Payment is still being processed. The booking cannot be released yet.' }, { status: 409 })
  }

  const released = await failPendingRazorpayPayment({
    bookingId: parsed.data.bookingId,
    orderId: parsed.data.razorpayOrderId,
    paymentId: parsed.data.razorpayPaymentId,
    customerId: session!.user.id,
  })

  return NextResponse.json({ success: true, released })
}
