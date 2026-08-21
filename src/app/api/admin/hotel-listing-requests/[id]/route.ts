import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { requireApiPermission } from '@/lib/api-rbac'
import { prisma } from '@/lib/db'
import { sendHotelListingRequestDecisionEmail } from '@/lib/email'
import { PERMISSIONS } from '@/lib/rbac'

const decisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('REVIEW'),
    confirmation: z.literal('CONFIRM_HOTEL_REQUEST_REVIEW'),
    reason: z.string().trim().min(5).max(500),
  }).strict(),
  z.object({
    action: z.literal('REJECT'),
    reason: z.string().trim().min(5).max(500),
  }).strict(),
])

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.PARTNER_APPLICATION_MANAGE)
  if (permissionError) return permissionError

  const parsed = decisionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'A reason and explicit confirmation are required.' }, { status: 400 })
  }

  const { id } = await params
  try {
    const existing = await prisma.hotelListingRequest.findUnique({
      where: { id },
      include: { owner: { select: { name: true, email: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'Hotel listing request not found.' }, { status: 404 })
    if (existing.status !== 'PENDING') {
      return NextResponse.json({ error: 'This hotel request has already been reviewed.' }, { status: 409 })
    }

    const nextStatus = parsed.data.action === 'REVIEW' ? 'REVIEWED' : 'REJECTED'
    const updated = await prisma.$transaction(async transaction => {
      const result = await transaction.hotelListingRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: nextStatus,
          reviewedById: session!.user.id,
          reviewedAt: new Date(),
          reviewReason: parsed.data.reason,
        },
      })
      if (result.count !== 1) throw new Error('REQUEST_ALREADY_REVIEWED')

      await transaction.auditLog.create({
        data: {
          adminId: session!.user.id,
          action: nextStatus === 'REVIEWED' ? 'HOTEL_LISTING_REQUEST_REVIEWED' : 'HOTEL_LISTING_REQUEST_REJECTED',
          targetType: 'HotelListingRequest',
          targetId: id,
          metadata: {
            before: { status: existing.status },
            after: { status: nextStatus },
            ownerId: existing.ownerId,
            ownerEmail: existing.owner.email,
            hotelName: existing.hotelName,
            reason: parsed.data.reason,
          },
        },
      })

      return transaction.hotelListingRequest.findUniqueOrThrow({
        where: { id },
        include: { owner: { select: { name: true, email: true } } },
      })
    })

    sendHotelListingRequestDecisionEmail(updated, nextStatus === 'REVIEWED', parsed.data.reason).catch(error => {
      console.error('Hotel listing request decision email failed:', error)
    })

    return NextResponse.json({ request: { id: updated.id, status: updated.status } })
  } catch (error) {
    if (error instanceof Error && error.message === 'REQUEST_ALREADY_REVIEWED') {
      return NextResponse.json({ error: 'This hotel request has already been reviewed.' }, { status: 409 })
    }
    console.error('Hotel listing request decision error:', error)
    return NextResponse.json({ error: 'The hotel listing request could not be updated.' }, { status: 500 })
  }
}
