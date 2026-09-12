import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { todayInIndia } from '@/lib/booking-time'
import { generateSlotsForRoom } from '@/lib/slots'
import { enabledSlotTypesForRoom, roomAllowsSlotType } from '@/lib/room-slot-settings'

/**
 * Keeps every room's availability calendar extended into the future.
 *
 * Slots are pre-materialised rows, and nothing created them beyond a manual admin call
 * per room. The calendar therefore has a fixed end date, and once it passes, dated
 * search silently returns nothing - not an error, just no results, which looks like
 * broken search rather than exhausted inventory.
 *
 * Each room is extended using **its own existing slot pattern**, not a generated
 * default. The two differ substantially: rooms here run three separate 3-hour slots a
 * day and an overnight full-day slot (12:00 to 11:00), while the generator's defaults
 * produce one 3-hour slot and a same-day full-day slot. Imposing the defaults would
 * create a second, differently-timed full-day slot on every new date, and multi-night
 * bookings - which match slots by start and end time across dates - would stop finding
 * a continuous run.
 *
 * Channel-managed rooms are skipped: their availability comes from the channel, via
 * syncAvailabilityWindow.
 */

const DEFAULT_HORIZON_DAYS = 90
/** Bounded so a large estate spreads over several runs instead of one enormous write. */
const MAX_ROOMS_PER_RUN = 500

type SlotPattern = {
  slotType: string
  startTime: string
  endTime: string
}

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

function horizonDays() {
  const configured = Number(process.env.SLOT_HORIZON_DAYS)
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_HORIZON_DAYS
}

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function datesBetween(startDate: string, endDate: string) {
  const dates: string[] = []
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) dates.push(date)
  return dates
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = todayInIndia()
  const horizonDate = addDays(today, horizonDays())
  const startedAt = Date.now()
  let roomsExtended = 0
  let slotsCreated = 0
  let roomsWithoutPattern = 0

  try {
    const rooms = await prisma.room.findMany({
      where: {
        isActive: true,
        // Channel inventory is driven by the channel, never invented locally.
        channelMapping: null,
      },
      select: {
        id: true,
        threeHourEnabled: true,
        sixHourEnabled: true,
        twelveHourEnabled: true,
        nightStayEnabled: true,
      },
      orderBy: { id: 'asc' },
      take: MAX_ROOMS_PER_RUN,
    })

    for (const room of rooms) {
      const enabledSlotTypes = enabledSlotTypesForRoom(room)
      if (enabledSlotTypes.length === 0) continue

      const [latest, existingPatterns] = await Promise.all([
        prisma.roomSlot.findFirst({
          where: { roomId: room.id },
          orderBy: { date: 'desc' },
          select: { date: true },
        }),
        // The room's own shape, taken from what it already offers.
        prisma.roomSlot.findMany({
          where: { roomId: room.id },
          distinct: ['slotType', 'startTime'],
          select: { slotType: true, startTime: true, endTime: true },
        }),
      ])

      // Never backfill the past, and never re-walk dates the room already covers.
      const firstMissingDate = latest && latest.date >= today ? addDays(latest.date, 1) : today
      if (firstMissingDate > horizonDate) continue

      const dates = datesBetween(firstMissingDate, horizonDate)

      // A room that has never had slots has no pattern to copy, so fall back to the
      // generator - the same thing the manual per-room endpoint would produce for it.
      let patterns: SlotPattern[]
      if (existingPatterns.length > 0) {
        // Respect current settings: a stay type switched off since those rows were
        // written must not keep being generated.
        patterns = existingPatterns.filter(pattern => roomAllowsSlotType(room, pattern.slotType))
      } else {
        roomsWithoutPattern++
        patterns = generateSlotsForRoom({ roomId: room.id, date: today, enabledSlotTypes })
          .map(slot => ({ slotType: slot.slotType, startTime: slot.startTime, endTime: slot.endTime }))
      }
      if (patterns.length === 0) continue

      const rows = dates.flatMap(date =>
        patterns.map(pattern => ({
          roomId: room.id,
          date,
          slotType: pattern.slotType as 'H3' | 'H6' | 'H9' | 'H12' | 'FULLDAY',
          startTime: pattern.startTime,
          endTime: pattern.endTime,
        })),
      )

      // skipDuplicates makes a re-run a no-op rather than an error, so this cron is
      // safe to invoke repeatedly and safe to retry after a partial failure.
      const created = await prisma.roomSlot.createMany({ data: rows, skipDuplicates: true })
      slotsCreated += created.count
      if (created.count > 0) roomsExtended++
    }

    const more = rooms.length === MAX_ROOMS_PER_RUN

    logger.info('cron.extend_slot_horizon.completed', {
      horizonDate,
      roomsConsidered: rooms.length,
      roomsExtended,
      slotsCreated,
      roomsWithoutPattern,
      more,
      durationMs: Date.now() - startedAt,
    })

    return NextResponse.json({
      horizonDate,
      roomsConsidered: rooms.length,
      roomsExtended,
      slotsCreated,
      roomsWithoutPattern,
      more,
    })
  } catch (error) {
    logger.error('cron.extend_slot_horizon.failed', error, { horizonDate, slotsCreated })
    return NextResponse.json({ error: 'Failed to extend slot horizon' }, { status: 500 })
  }
}
