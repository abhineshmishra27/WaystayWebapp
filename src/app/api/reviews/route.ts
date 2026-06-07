import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'

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
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (session.user.role !== 'CUSTOMER') {
      return NextResponse.json({ error: 'Only customers can submit reviews' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = createReviewSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }

    const { bookingId, hotelId, rating, title, body: reviewBody, mediaUrls } = parsed.data
    const customerId = session.user.id

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    if (booking.customerId !== customerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (booking.status !== 'COMPLETED') return NextResponse.json({ error: 'You can only review completed stays' }, { status: 400 })

    const existing = await prisma.review.findUnique({ where: { bookingId } })
    if (existing) return NextResponse.json({ error: 'You have already reviewed this stay' }, { status: 409 })

    const review = await prisma.review.create({
      data: {
        bookingId,
        customerId,
        hotelId,
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

