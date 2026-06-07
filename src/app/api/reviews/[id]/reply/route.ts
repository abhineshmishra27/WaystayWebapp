import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const schema = z.object({ reply: z.string().min(10).max(500) })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session || session.user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid reply' }, { status: 400 })

    const review = await prisma.review.findUnique({
      where: { id },
      include: { hotel: { select: { ownerId: true } } },
    })

    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 })
    if (review.hotel.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'You cannot reply to this review' }, { status: 403 })
    }

    const updated = await prisma.review.update({
      where: { id },
      data: { ownerReply: parsed.data.reply },
    })

    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: 'Failed to submit reply' }, { status: 500 })
  }
}
