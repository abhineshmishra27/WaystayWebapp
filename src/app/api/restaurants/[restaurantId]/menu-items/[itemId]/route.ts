import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { requireApiPermission } from '@/lib/api-rbac'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'
import { z } from 'zod'

const updateItemSchema = z.object({
  category: z.string().min(2).optional(),
  name: z.string().min(2).optional(),
  description: z.string().nullable().optional(),
  price: z.number().positive().optional(),
  isVeg: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  imageUrl: z.string().url().nullable().optional(),
}).strict()

async function canManageItem(userId: string, role: 'ADMIN' | 'OWNER' | 'CUSTOMER', restaurantId: string, itemId: string) {
  const item = await prisma.menuItem.findFirst({
    where: { id: itemId, restaurantId },
    include: { restaurant: { include: { hotel: { select: { ownerId: true } } } } },
  })
  if (!item) return null
  if (!hasPermission(role, PERMISSIONS.ADMIN_ACCESS) && item.restaurant.hotel.ownerId !== userId) return false
  return true
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ restaurantId: string; itemId: string }> }) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.RESTAURANT_MANAGE)
    if (permissionError) return permissionError

    const { restaurantId, itemId } = await params
    const allowed = await canManageItem(session!.user.id, session!.user.role, restaurantId, itemId)
    if (allowed === null) return NextResponse.json({ error: 'Menu item not found' }, { status: 404 })
    if (!allowed) return NextResponse.json({ error: 'You do not manage this restaurant.' }, { status: 403 })
    const parsed = updateItemSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid menu item update.' }, { status: 400 })
    const item = await prisma.menuItem.update({ where: { id: itemId }, data: parsed.data })
    return NextResponse.json(item)
  } catch {
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ restaurantId: string; itemId: string }> }) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.RESTAURANT_MANAGE)
    if (permissionError) return permissionError

    const { restaurantId, itemId } = await params
    const allowed = await canManageItem(session!.user.id, session!.user.role, restaurantId, itemId)
    if (allowed === null) return NextResponse.json({ error: 'Menu item not found' }, { status: 404 })
    if (!allowed) return NextResponse.json({ error: 'You do not manage this restaurant.' }, { status: 403 })
    await prisma.menuItem.update({ where: { id: itemId }, data: { isAvailable: false } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
  }
}
