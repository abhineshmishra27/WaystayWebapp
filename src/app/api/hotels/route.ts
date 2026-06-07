import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

const createHotelSchema = z.object({
  name: z.string().min(3, 'Hotel name too short'),
  description: z.string().min(20, 'Description too short'),
  address: z.string().min(5),
  city: z.string().min(2),
  state: z.string().min(2),
  country: z.string().default('India'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  checkInTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format: HH:MM'),
  checkOutTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format: HH:MM'),
  amenities: z.array(z.string()).default([]),
  imageUrls: z.array(z.object({ url: z.string().url(), publicId: z.string() })).default([]),
})

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    const { searchParams } = new URL(req.url, process.env.NEXTAUTH_URL || 'http://localhost:3000')
    const city = searchParams.get('city')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = 20
    const skip = (page - 1) * limit

    const where: Prisma.HotelWhereInput = { isActive: true }

    // Admins can see unapproved hotels
    if (!session || session.user.role !== 'ADMIN') {
      where.isApproved = true
    }

    if (city) {
      where.city = { contains: city, mode: 'insensitive' }
    }

    const hotels = await prisma.hotel.findMany({
      where,
      include: {
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
        _count: { select: { reviews: true } },
        reviews: { select: { rating: true } },
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
    if (!session || session.user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Only hotel owners can create hotels' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = createHotelSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }

    const { imageUrls, ...hotelData } = parsed.data

    const hotel = await prisma.hotel.create({
      data: {
        ...hotelData,
        ownerId: session.user.id,
        pincode: '',
        rating_avg: 0,
        total_review: 0,
        license_number: '',
        gst_number: '',
        images: {
          create: imageUrls.map((img, idx) => ({
            url: img.url,
            publicId: img.publicId,
            sortOrder: idx,
            uploadedById: session.user.id,
          })),
        },
      },
      include: { images: true },
    })

    return NextResponse.json(hotel, { status: 201 })
  } catch (error) {
    console.error('POST /api/hotels error:', error)
    return NextResponse.json({ error: 'Failed to create hotel' }, { status: 500 })
  }
}

