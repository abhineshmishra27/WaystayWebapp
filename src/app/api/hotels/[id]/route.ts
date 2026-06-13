import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
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
          include: {
            media: true,
            customer: { select: { name: true, avatarUrl: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        _count: { select: { reviews: true } },
        restaurant: { include: { menuItems: { where: { isAvailable: true }, orderBy: { category: 'asc' } } } },
      },
    })

    if (!hotel) return NextResponse.json({ error: 'Hotel not found' }, { status: 404 })

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
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    const role = session.user.role
    const userId = session.user.id

    const hotel = await prisma.hotel.findUnique({ where: { id } })
    if (!hotel) return NextResponse.json({ error: 'Hotel not found' }, { status: 404 })

    if (role !== 'ADMIN' && hotel.ownerId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const updated = await prisma.hotel.update({ where: { id }, data: body })

    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: 'Failed to update hotel' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }
    const { id } = await params
    await prisma.hotel.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json({ message: 'Hotel deactivated' })
  } catch {
    return NextResponse.json({ error: 'Failed to deactivate hotel' }, { status: 500 })
  }
}
