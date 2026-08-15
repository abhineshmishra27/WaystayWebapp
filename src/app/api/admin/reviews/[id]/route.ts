import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { requireApiPermission } from '@/lib/api-rbac'
import { PERMISSIONS } from '@/lib/rbac'

const schema = z.object({
  status: z.enum(['PUBLISHED', 'HIDDEN']),
  reason: z.string().trim().min(5).max(500),
  confirmation: z.literal('CONFIRM_REVIEW_MODERATION'),
}).strict()

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.REVIEW_MODERATE)
  if (permissionError) return permissionError

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Explicit confirmation and a reason of at least 5 characters are required.' }, { status: 400 })
  }

  const { id } = await params
  const review = await prisma.review.findUnique({
    where: { id },
    select: { id: true, title: true, status: true, moderationReason: true, hotelId: true, customerId: true },
  })
  if (!review) return NextResponse.json({ error: 'Review not found.' }, { status: 404 })
  if (review.status === parsed.data.status) {
    return NextResponse.json({ review: { id: review.id, status: review.status }, unchanged: true })
  }

  const moderatedAt = new Date()
  const updated = await prisma.$transaction(async tx => {
    const changed = await tx.review.updateMany({
      where: { id, status: review.status },
      data: {
        status: parsed.data.status,
        moderationReason: parsed.data.reason,
        moderatedAt,
      },
    })
    if (changed.count !== 1) throw new Error('REVIEW_STATE_CHANGED')

    await tx.auditLog.create({
      data: {
        adminId: session!.user.id,
        action: parsed.data.status === 'HIDDEN' ? 'REVIEW_HIDDEN' : 'REVIEW_PUBLISHED',
        targetType: 'Review',
        targetId: review.id,
        hotelId: review.hotelId,
        metadata: {
          before: { status: review.status, moderationReason: review.moderationReason },
          after: { status: parsed.data.status, moderationReason: parsed.data.reason, moderatedAt: moderatedAt.toISOString() },
          reason: parsed.data.reason,
          customerId: review.customerId,
        },
      },
    })

    return tx.review.findUniqueOrThrow({
      where: { id },
      select: { id: true, status: true, moderationReason: true, moderatedAt: true },
    })
  }).catch(error => {
    if (error instanceof Error && error.message === 'REVIEW_STATE_CHANGED') return null
    throw error
  })

  if (!updated) {
    return NextResponse.json({ error: 'The review changed while moderation was in progress. Refresh and retry.' }, { status: 409 })
  }
  return NextResponse.json({ review: updated })
}
