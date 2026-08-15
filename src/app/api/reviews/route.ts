import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { requireApiPermission } from '@/lib/api-rbac'
import { PERMISSIONS } from '@/lib/rbac'

const createReviewSchema = z.object({
  bookingId: z.string(),
  hotelId: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string().min(5, 'Title too short').max(100, 'Title too long'),
  body: z.string().min(20, 'Review too short (min 20 chars)').max(2000, 'Review too long'),
  mediaUrls: z.array(z.string().url()).max(5).default([]),
})

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.REVIEW_CREATE)
    if (permissionError) return permissionError

    const body = await req.json()
    const parsed = createReviewSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }

    const { bookingId, hotelId, rating, title, body: reviewBody, mediaUrls } = parsed.data
    const customerId = session!.user.id

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { roomSlot: { include: { room: { select: { hotelId: true } } } } },
    })
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    if (booking.customerId !== customerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (booking.status !== 'COMPLETED') return NextResponse.json({ error: 'You can only review completed stays' }, { status: 400 })
    if (booking.roomSlot.room.hotelId !== hotelId) return NextResponse.json({ error: 'Hotel does not match this booking' }, { status: 400 })

    const existing = await prisma.review.findUnique({ where: { bookingId } })
    if (existing) return NextResponse.json({ error: 'You have already reviewed this stay' }, { status: 409 })

    const review = await prisma.review.create({
      data: {
        bookingId,
        customerId,
        hotelId: booking.roomSlot.room.hotelId,
        rating,
        title,
        body: reviewBody,
        media: { create: mediaUrls.map(url => ({ url, type: 'IMAGE' })) },
      },
      include: { media: true, customer: { select: { name: true, avatarUrl: true } } },
    })

    return NextResponse.json(review, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to submit review' }, { status: 500 })
  }
}

