import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export async function GET(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const { roomId } = await params
    const { searchParams } = new URL(req.url, process.env.NEXTAUTH_URL || 'http://localhost:3000')
    const date = searchParams.get('date')
    const startDate = searchParams.get('startDate') ?? date
    const endDate = searchParams.get('endDate') ?? startDate

    const where: Prisma.RoomSlotWhereInput = { roomId }
    if (startDate && endDate) {
      where.date = { gte: startDate, lte: endDate }
    } else if (date) {
      where.date = date
    }

    const slots = await prisma.roomSlot.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    })

    const availability = slots.reduce<Record<string, Array<{ id: string; date: string; startTime: string; endTime: string; slotType: string; isBooked: boolean }>>>(
      (acc, slot) => {
        const key = slot.date
        if (!acc[key]) acc[key] = []
        acc[key].push({
          id: slot.id,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          slotType: slot.slotType,
          isBooked: slot.isBooked,
        })
        return acc
      },
      {},
    )

    return NextResponse.json({ roomId, availability })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 500 })
  }
}
