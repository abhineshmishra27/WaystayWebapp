import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const schema = z.object({
  approved: z.boolean(),
  reason: z.string().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { id } = await params
    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

    const hotel = await prisma.hotel.findUnique({
      where: { id },
      include: { owner: { select: { email: true, name: true } } },
    })
    if (!hotel) return NextResponse.json({ error: 'Hotel not found' }, { status: 404 })

    const [updatedHotel] = await prisma.$transaction([
      prisma.hotel.update({ where: { id }, data: { isApproved: parsed.data.approved } }),
      prisma.auditLog.create({
        data: {
          adminId: session.user.id,
          action: parsed.data.approved ? 'HOTEL_APPROVED' : 'HOTEL_REJECTED',
          targetType: 'Hotel',
          targetId: id,
          hotelId: id,
          metadata: {
            reason: parsed.data.reason,
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
        parsed.data.reason,
      )
    } catch (emailError) {
      console.error('Email failed (non-blocking):', emailError)
    }

    return NextResponse.json(updatedHotel)
  } catch {
    return NextResponse.json({ error: 'Failed to update hotel approval' }, { status: 500 })
  }
}
