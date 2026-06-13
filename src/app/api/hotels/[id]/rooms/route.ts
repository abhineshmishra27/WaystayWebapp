import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const roomSchema = z.object({
  name: z.string().min(3),
  type: z.enum(['STANDARD', 'DELUXE', 'SUITE']),
  description: z.string().min(10),
  pricePerHour: z.number().positive(),
  price3h: z.number().positive().optional(),
  price6h: z.number().positive().optional(),
  price9h: z.number().positive().optional(),
  price12h: z.number().positive().optional(),
  priceFullDay: z.number().positive(),
  maxOccupancy: z.number().int().min(1).max(10).default(2),
  amenities: z.array(z.string()).default([]),
  images: z.array(z.string().url()).default([]),
  floorNumber: z.number().int().min(0).default(1),
  areaSqft: z.number().positive().default(250),
  aiCleanScore: z.number().min(0).max(100).default(100),
  aiLastCheckedAt: z.string().optional(),
  baseCleanVideoId: z.string().optional().default(''),
  lastCleanVideoId: z.string().optional().default(''),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const rooms = await prisma.room.findMany({
      where: { hotelId: id, isActive: true },
      include: { _count: { select: { slots: { where: { isBooked: false } } } } },
    })
    return NextResponse.json(rooms)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch rooms' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: hotelId } = await params
    const role = session.user.role
    const userId = session.user.id

    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
    if (!hotel) return NextResponse.json({ error: 'Hotel not found' }, { status: 404 })

    if (role === 'OWNER' && hotel.ownerId !== userId) {
      return NextResponse.json({ error: 'You do not own this hotel' }, { status: 403 })
    }

    if (role !== 'ADMIN' && role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = roomSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }

    const data = {
      hotelId,
      name: parsed.data.name,
      type: parsed.data.type,
      description: parsed.data.description,
      available: true,
      pricePerHour: parsed.data.pricePerHour,
      price_3h: parsed.data.price3h ?? parsed.data.pricePerHour,
      price_6h: parsed.data.price6h ?? parsed.data.pricePerHour,
      price_9h: parsed.data.price9h ?? parsed.data.pricePerHour,
      price_12h: parsed.data.price12h ?? parsed.data.pricePerHour,
      priceFullDay: parsed.data.priceFullDay,
      maxOccupancy: parsed.data.maxOccupancy,
      amenities: parsed.data.amenities,
      images: parsed.data.images,
      base_clean_video_id: parsed.data.baseCleanVideoId || '',
      last_clean_video_id: parsed.data.lastCleanVideoId || '',
      floor_number: parsed.data.floorNumber,
      area_sqft: parsed.data.areaSqft,
      ai_clean_score: parsed.data.aiCleanScore,
      ai_last_checked_at: parsed.data.aiLastCheckedAt ? new Date(parsed.data.aiLastCheckedAt) : new Date(),
      ai_clean_status: 'clean',
    }
    const room = await prisma.room.create({ data })
    return NextResponse.json(room, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 })
  }
}
