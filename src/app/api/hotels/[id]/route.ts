import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { requireApiPermission } from '@/lib/api-rbac'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'
import { z } from 'zod'

const updateHotelSchema = z.object({
  name: z.string().min(3).optional(),
  description: z.string().min(20).optional(),
  address: z.string().min(5).optional(),
  city: z.string().min(2).optional(),
  state: z.string().min(2).optional(),
  country: z.string().min(2).optional(),
  pincode: z.string().max(12).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  highway_tag: z.boolean().optional(),
  checkInTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  checkOutTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  amenities: z.array(z.string()).optional(),
  checkin_policy: z.string().max(500).optional(),
  checkout_policy: z.string().max(500).optional(),
  license_number: z.string().max(100).optional(),
  gst_number: z.string().max(100).optional(),
}).strict()

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    const { id } = await params

    const hotel = await prisma.hotel.findUnique({
      where: { id },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        rooms: {
          where: { isActive: true },
          include: { _count: { select: { slots: { where: { isBooked: false } } } } },
          orderBy: { price_3h: 'asc' },
        },
        reviews: {
          where: { status: 'PUBLISHED' },
          include: {
            media: true,
            customer: { select: { name: true, avatarUrl: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        _count: { select: { reviews: { where: { status: 'PUBLISHED' } } } },
        restaurant: { include: { menuItems: { where: { isAvailable: true }, orderBy: { category: 'asc' } } } },
      },
    })

    if (!hotel) return NextResponse.json({ error: 'Hotel not found' }, { status: 404 })
    const canManageDraft = Boolean(
      session?.user.isActive && (
        hasPermission(session.user.role, PERMISSIONS.ADMIN_ACCESS) ||
        hotel.ownerId === session.user.id
      ),
    )
    if ((!hotel.isApproved || !hotel.isActive || !hotel.ownerEnabled) && !canManageDraft) {
      return NextResponse.json({ error: 'Hotel not found' }, { status: 404 })
    }

    const avgRating = hotel.reviews.length > 0
      ? hotel.reviews.reduce((sum, r) => sum + r.rating, 0) / hotel.reviews.length
      : 0

    return NextResponse.json({ ...hotel, avgRating })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch hotel' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.HOTEL_MANAGE)
    if (permissionError) return permissionError

    const { id } = await params
    const role = session!.user.role
    const userId = session!.user.id

    const hotel = await prisma.hotel.findUnique({ where: { id } })
    if (!hotel) return NextResponse.json({ error: 'Hotel not found' }, { status: 404 })

    if (!hasPermission(role, PERMISSIONS.ADMIN_ACCESS) && hotel.ownerId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const parsed = updateHotelSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }
    const updated = await prisma.hotel.update({ where: { id }, data: parsed.data })

    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: 'Failed to update hotel' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.HOTEL_APPROVE)
    if (permissionError) return permissionError
    const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).strict().safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'A reason of at least 5 characters is required.' }, { status: 400 })
    const { id } = await params
    const hotel = await prisma.hotel.findUnique({ where: { id }, select: { id: true, name: true, isActive: true } })
    if (!hotel) return NextResponse.json({ error: 'Hotel not found' }, { status: 404 })
    if (!hotel.isActive) return NextResponse.json({ message: 'Hotel already suspended', unchanged: true })
    await prisma.$transaction([
      prisma.hotel.update({ where: { id }, data: { isActive: false } }),
      prisma.auditLog.create({ data: { adminId: session!.user.id, action: 'HOTEL_SUSPENDED', targetType: 'Hotel', targetId: id, hotelId: id, metadata: { before: { isActive: true }, after: { isActive: false }, reason: parsed.data.reason } } }),
    ])
    return NextResponse.json({ message: 'Hotel deactivated' })
  } catch {
    return NextResponse.json({ error: 'Failed to deactivate hotel' }, { status: 500 })
  }
}
