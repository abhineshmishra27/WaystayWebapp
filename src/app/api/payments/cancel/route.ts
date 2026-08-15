import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { failPendingRazorpayPayment } from '@/lib/payments'
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

  const released = await failPendingRazorpayPayment({
    bookingId: parsed.data.bookingId,
    orderId: parsed.data.razorpayOrderId,
    paymentId: parsed.data.razorpayPaymentId,
    customerId: session!.user.id,
  })

  return NextResponse.json({ success: true, released })
}
