import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { requireApiPermission } from '@/lib/api-rbac'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'

const schema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: hotelId } = await params
    const restaurant = await prisma.restaurant.findUnique({
      where: { hotelId },
      include: { menuItems: { where: { isAvailable: true }, orderBy: { category: 'asc' } } },
    })
    if (!restaurant) return NextResponse.json(null)
    return NextResponse.json(restaurant)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch restaurant' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.RESTAURANT_MANAGE)
    if (permissionError) return permissionError

    const { id: hotelId } = await params
    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
    if (!hotel) return NextResponse.json({ error: 'Hotel not found' }, { status: 404 })

    const role = session!.user.role
    const userId = session!.user.id
    if (!hasPermission(role, PERMISSIONS.ADMIN_ACCESS) && hotel.ownerId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed' }, { status: 400 })

    const restaurant = await prisma.restaurant.create({ data: { ...parsed.data, hotelId } })
    return NextResponse.json(restaurant, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to create restaurant' }, { status: 500 })
  }
}
