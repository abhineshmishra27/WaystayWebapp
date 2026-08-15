import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { z } from 'zod'
import { requireApiPermission } from '@/lib/api-rbac'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'

const itemSchema = z.object({
  category: z.string().min(2),
  name: z.string().min(2),
  description: z.string().optional(),
  price: z.number().positive(),
  isVeg: z.boolean().default(false),
  imageUrl: z.string().url().optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ restaurantId: string }> }) {
  try {
    const { restaurantId } = await params
    const items = await prisma.menuItem.findMany({
      where: { restaurantId, isAvailable: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    return NextResponse.json(items)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch menu items' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ restaurantId: string }> }) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.RESTAURANT_MANAGE)
    if (permissionError) return permissionError

    const { restaurantId } = await params
    const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, include: { hotel: { select: { ownerId: true } } } })
    if (!restaurant) return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 })
    if (!hasPermission(session!.user.role, PERMISSIONS.ADMIN_ACCESS) && restaurant.hotel.ownerId !== session!.user.id) {
      return NextResponse.json({ error: 'You do not manage this restaurant.' }, { status: 403 })
    }
    const body = await req.json()
    const parsed = itemSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })

    const item = await prisma.menuItem.create({ data: { ...parsed.data, restaurantId } })
    return NextResponse.json(item, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Failed to create menu item' }, { status: 500 })
  }
}
