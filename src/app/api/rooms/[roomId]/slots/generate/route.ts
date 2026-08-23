import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateSlotsForRoom } from '@/lib/slots'
import { z } from 'zod'
import { requireApiPermission } from '@/lib/api-rbac'
import { hasPermission, PERMISSIONS } from '@/lib/rbac'
import { enabledSlotTypesForRoom } from '@/lib/room-slot-settings'

const slotGenerationSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.number().min(0).max(23).optional(),
  endHour: z.number().min(1).max(24).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const session = await auth()
    const permissionError = requireApiPermission(session, PERMISSIONS.HOTEL_MANAGE)
    if (permissionError) return permissionError

    const { roomId } = await params
    const room = await prisma.room.findUnique({ where: { id: roomId }, include: { hotel: true } })
    if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

    const role = session!.user.role
    const userId = session!.user.id
    if (!hasPermission(role, PERMISSIONS.ADMIN_ACCESS) && room.hotel.ownerId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const parsed = slotGenerationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 })
    }

    const { date, startHour, endHour } = parsed.data
    const slotsData = generateSlotsForRoom({
      roomId,
      date,
      startHour,
      endHour,
      enabledSlotTypes: enabledSlotTypesForRoom(room),
    })

    const createdSlots = await prisma.roomSlot.createMany({ data: slotsData, skipDuplicates: true })
    return NextResponse.json({ created: createdSlots.count })
  } catch {
    return NextResponse.json({ error: 'Failed to generate slots' }, { status: 500 })
  }
}
