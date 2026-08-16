import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { requireApiPermission } from '@/lib/api-rbac'
import { getEffectiveRole, hasPermission, PERMISSIONS, sessionHasPermission } from '@/lib/rbac'

const createHotelSchema = z.object({
  ownerId: z.string().min(1),
  name: z.string().min(3, 'Hotel name too short'),
  description: z.string().min(20, 'Description too short'),
  address: z.string().min(5),
  city: z.string().min(2),
  state: z.string().min(2),
  country: z.string().default('India'),
  pincode: z.string().trim().min(4).max(12),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  checkInTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format: HH:MM'),
  checkOutTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format: HH:MM'),
  amenities: z.array(z.string()).default([]),
  license_number: z.string().trim().min(3).max(100),
  gst_number: z.string().trim().min(15).max(15),
  rating_avg: z.number().min(0).max(5).default(0),
  imageUrls: z.array(z.object({ url: z.string().url(), publicId: z.string() })).default([]),
}).strict()

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    const { searchParams } = new URL(req.url, process.env.NEXTAUTH_URL || 'http://localhost:3000')
    const city = searchParams.get('city')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = 20
    const skip = (page - 1) * limit

    const where: Prisma.HotelWhereInput = { isActive: true, ownerEnabled: true }

    // Admins can see unapproved hotels
    if (!sessionHasPermission(session, PERMISSIONS.ADMIN_ACCESS)) {
      where.isApproved = true
    }

    if (city) {
      where.city = { contains: city, mode: 'insensitive' }
    }

    const hotels = await prisma.hotel.findMany({
      where,
      include: {
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
        _count: { select: { reviews: { where: { status: 'PUBLISHED' } } } },
        reviews: { where: { status: 'PUBLISHED' }, select: { rating: true } },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    })

    const hotelsWithRating = hotels.map(h => ({
      ...h,
      avgRating: h.reviews.length > 0
        ? h.reviews.reduce((sum, r) => sum + r.rating, 0) / h.reviews.length
        : 0,
      reviews: undefined,
    }))

    return NextResponse.json({ hotels: hotelsWithRating, page, limit })
  } catch (error) {
    console.error('GET /api/hotels error:', error)
    return NextResponse.json({ error: 'Failed to fetch hotels' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.HOTEL_CREATE)
    if (permissionError) return permissionError

    const body = await req.json()
    const parsed = createHotelSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }

    const { imageUrls, ownerId, ...hotelData } = parsed.data
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true, email: true, role: true, isActive: true } })
    if (!owner || !owner.isActive || !hasPermission(getEffectiveRole(owner.email, owner.role), PERMISSIONS.OWNER_ACCESS)) {
      return NextResponse.json({ error: 'Choose an active approved hotel owner.' }, { status: 400 })
    }

    const hotel = await prisma.$transaction(async transaction => {
      const created = await transaction.hotel.create({
        data: {
          ...hotelData,
          ownerId,
          total_review: 0,
          images: {
            create: imageUrls.map((img, idx) => ({
              url: img.url,
              publicId: img.publicId,
              sortOrder: idx,
              uploadedById: session!.user.id,
            })),
          },
        },
        include: { images: true },
      })
      await transaction.auditLog.create({
        data: {
          adminId: session!.user.id,
          action: 'HOTEL_CREATED_BY_ADMIN',
          targetType: 'Hotel',
          targetId: created.id,
          hotelId: created.id,
          metadata: { ownerId, hotelName: created.name, reason: 'Hotel content added by Waystay administration.' },
        },
      })
      return created
    })

    return NextResponse.json(hotel, { status: 201 })
  } catch (error) {
    console.error('POST /api/hotels error:', error)
    return NextResponse.json({ error: 'Failed to create hotel' }, { status: 500 })
  }
}

