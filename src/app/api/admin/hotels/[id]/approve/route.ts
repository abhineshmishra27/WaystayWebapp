import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { requireApiPermission } from '@/lib/api-rbac'
import { PERMISSIONS } from '@/lib/rbac'

const schema = z.object({
  approved: z.boolean(),
  reason: z.string().trim().max(500).optional(),
}).strict().superRefine((data, context) => {
  if (!data.approved && (!data.reason || data.reason.length < 5)) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'A rejection reason of at least 5 characters is required.' })
  }
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.HOTEL_APPROVE)
    if (permissionError) return permissionError

    const { id } = await params
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid approval request.' }, { status: 400 })

    const hotel = await prisma.hotel.findUnique({
      where: { id },
      include: { owner: { select: { email: true, name: true } } },
    })
    if (!hotel) return NextResponse.json({ error: 'Hotel not found' }, { status: 404 })
    if (!hotel.isActive) return NextResponse.json({ error: 'A deactivated hotel cannot be approved or rejected.' }, { status: 400 })

    const latestDecision = await prisma.auditLog.findFirst({
      where: { hotelId: id, action: { in: ['HOTEL_APPROVED', 'HOTEL_REJECTED'] } },
      select: { action: true },
      orderBy: { createdAt: 'desc' },
    })
    const requestedAction = parsed.data.approved ? 'HOTEL_APPROVED' : 'HOTEL_REJECTED'
    const previousStatus = hotel.isApproved ? 'APPROVED' : latestDecision?.action === 'HOTEL_REJECTED' ? 'REJECTED' : 'PENDING'
    const decisionReason = parsed.data.reason || 'Approved after administrative review.'
    if (hotel.isApproved === parsed.data.approved && latestDecision?.action === requestedAction) {
      return NextResponse.json({ ...hotel, approvalStatus: parsed.data.approved ? 'APPROVED' : 'REJECTED', unchanged: true })
    }

    const [updatedHotel] = await prisma.$transaction([
      prisma.hotel.update({ where: { id }, data: { isApproved: parsed.data.approved } }),
      prisma.auditLog.create({
        data: {
          adminId: session!.user.id,
          action: requestedAction,
          targetType: 'Hotel',
          targetId: id,
          hotelId: id,
          metadata: {
            before: { approvalStatus: previousStatus, isApproved: hotel.isApproved },
            after: { approvalStatus: parsed.data.approved ? 'APPROVED' : 'REJECTED', isApproved: parsed.data.approved },
            reason: decisionReason,
            hotelName: hotel.name,
            ownerEmail: hotel.owner.email,
          },
        },
      }),
    ])

    try {
      const { sendHotelStatusEmail } = await import('@/lib/email')
      await sendHotelStatusEmail(
        hotel.owner.email,
        hotel.owner.name,
        hotel.name,
        parsed.data.approved,
        decisionReason,
      )
    } catch (emailError) {
      console.error('Email failed (non-blocking):', emailError)
    }

    return NextResponse.json({ ...updatedHotel, approvalStatus: parsed.data.approved ? 'APPROVED' : 'REJECTED' })
  } catch (error) {
    console.error('Hotel approval error:', error)
    return NextResponse.json({ error: 'Failed to update hotel approval' }, { status: 500 })
  }
}
