import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { requireApiPermission } from '@/lib/api-rbac'
import { prisma } from '@/lib/db'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'

const settingsSchema = z.object({
  threeHourEnabled: z.boolean().optional(),
  sixHourEnabled: z.boolean().optional(),
  twelveHourEnabled: z.boolean().optional(),
  nightStayEnabled: z.boolean().optional(),
}).strict().refine(settings => Object.keys(settings).length > 0, 'At least one setting is required')

const settingsSelect = {
  id: true,
  threeHourEnabled: true,
  sixHourEnabled: true,
  twelveHourEnabled: true,
  nightStayEnabled: true,
} as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.HOTEL_STATUS_MANAGE)
    if (permissionError) return permissionError

    const { roomId } = await params
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, hotel: { select: { ownerId: true } } },
    })
    if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    if (!hasPermission(session!.user.role, PERMISSIONS.ADMIN_ACCESS) && room.hotel.ownerId !== session!.user.id) {
      return NextResponse.json({ error: 'You do not own this room' }, { status: 403 })
    }

    const parsed = settingsSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }

    const updatedRoom = await prisma.room.update({
      where: { id: roomId },
      data: parsed.data,
      select: settingsSelect,
    })

    return NextResponse.json({ room: updatedRoom })
  } catch (error) {
    console.error('Room stay-option update error:', error)
    return NextResponse.json({ error: 'Unable to update room stay options' }, { status: 500 })
  }
}
