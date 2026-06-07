import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ restaurantId: string; itemId: string }> }) {
  try {
    const session = await auth()
    if (!session || session.user.role === 'CUSTOMER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { itemId } = await params
    const body = await req.json()
    const item = await prisma.menuItem.update({ where: { id: itemId }, data: body })
    return NextResponse.json(item)
  } catch {
    return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ restaurantId: string; itemId: string }> }) {
  try {
    const session = await auth()
    if (!session || session.user.role === 'CUSTOMER') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { itemId } = await params
    await prisma.menuItem.update({ where: { id: itemId }, data: { isAvailable: false } })
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
  }
}
