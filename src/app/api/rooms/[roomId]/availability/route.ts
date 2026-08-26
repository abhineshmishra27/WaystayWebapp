import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { slotIsUnavailable } from '@/lib/booking-inventory'
import { slotIsPastForBooking, todayInIndia } from '@/lib/booking-time'
import { roomAllowsSlotType } from '@/lib/room-slot-settings'

export async function GET(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    const { roomId } = await params
    const { searchParams } = new URL(req.url, process.env.NEXTAUTH_URL || 'http://localhost:3000')
    const date = searchParams.get('date')
    const startDate = searchParams.get('startDate') ?? date
    const endDate = searchParams.get('endDate') ?? startDate
    const requestedRoomCount = Math.max(1, Math.min(10, parseInt(searchParams.get('roomCount') || '1', 10) || 1))

    const now = new Date()
    const today = todayInIndia(now)
    const effectiveStartDate = startDate && startDate > today ? startDate : today
    const effectiveEndDate = endDate && endDate > effectiveStartDate ? endDate : effectiveStartDate

    const where: Prisma.RoomSlotWhereInput = { roomId }
    if (effectiveStartDate && effectiveEndDate) {
      where.date = { gte: effectiveStartDate, lte: effectiveEndDate }
    } else if (date) {
      where.date = { gte: today }
    }

    const [room, slots, activeBookings] = await Promise.all([
      prisma.room.findUnique({
        where: { id: roomId },
        select: {
          inventoryCount: true,
          threeHourEnabled: true,
          sixHourEnabled: true,
          twelveHourEnabled: true,
          nightStayEnabled: true,
        },
      }),
      prisma.roomSlot.findMany({
        where,
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      }),
      prisma.booking.findMany({
        where: {
          status: { in: ['PENDING', 'CONFIRMED'] },
          roomSlot: { roomId, date: { lte: effectiveEndDate } },
        },
        select: {
          totalHours: true,
          roomCount: true,
          roomSlot: { select: { date: true, slotType: true, startTime: true, endTime: true } },
        },
      }),
    ])
    if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

    const availability = slots.reduce<Record<string, Array<{ id: string; date: string; startTime: string; endTime: string; slotType: string; isBooked: boolean; hasStarted: boolean; isEnabled: boolean }>>>(
      (acc, slot) => {
        const key = slot.date
        const hasStarted = slotIsPastForBooking(slot.slotType, slot.date, slot.startTime, now)
        const isEnabled = roomAllowsSlotType(room, slot.slotType)
        if (!acc[key]) acc[key] = []
        acc[key].push({
          id: slot.id,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          slotType: slot.slotType,
          isBooked: slotIsUnavailable(
            slot,
            activeBookings,
            slot.slotType === 'FULLDAY' ? effectiveEndDate : slot.date,
            room.inventoryCount,
            requestedRoomCount,
          ),
          hasStarted,
          isEnabled,
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
