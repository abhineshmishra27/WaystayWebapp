import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { todayInIndia } from '@/lib/booking-time'

/**
 * Deletes RoomSlot rows for dates that have passed, and channel holds alongside them.
 *
 * Availability is pre-materialised as one row per room per date per stay type, and
 * nothing ever removed the rows once their date went by. At 52 rooms two thirds of the
 * table was already dead weight; a channel-manager import multiplies the room count and
 * the table grows without bound, slowing every availability and booking query that
 * scans it.
 *
 * A slot referenced by a booking is never deleted, whatever its age - booking history
 * has to stay intact, and the Booking -> RoomSlot foreign key would refuse anyway.
 * Recent past dates are also kept, so anything still reconciling or being supported has
 * its slot rows to hand.
 */

const DEFAULT_RETENTION_DAYS = 30
/** Bounded so one run cannot hold long locks or blow up memory on a large backlog. */
const DELETE_BATCH_SIZE = 5_000
const MAX_BATCHES_PER_RUN = 20

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

function retentionCutoff() {
  const configured = Number(process.env.SLOT_RETENTION_DAYS)
  const days = Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : DEFAULT_RETENTION_DAYS
  const cutoffMs = Date.parse(`${todayInIndia()}T00:00:00Z`) - days * 86_400_000
  return new Date(cutoffMs).toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoffDate = retentionCutoff()
  const startedAt = Date.now()
  let slotsDeleted = 0
  let holdsDeleted = 0
  let batches = 0

  try {
    // Deleted in batches by primary key: `deleteMany` with a plain date filter would
    // take one lock over the whole backlog while bookings are being made against
    // current dates in the same table.
    for (; batches < MAX_BATCHES_PER_RUN; batches++) {
      const doomed = await prisma.roomSlot.findMany({
        where: {
          date: { lt: cutoffDate },
          // Never orphan a booking's slot, regardless of age.
          bookings: { none: {} },
        },
        select: { id: true },
        take: DELETE_BATCH_SIZE,
      })
      if (doomed.length === 0) break

      const removed = await prisma.roomSlot.deleteMany({
        where: { id: { in: doomed.map(slot => slot.id) } },
      })
      slotsDeleted += removed.count
      if (doomed.length < DELETE_BATCH_SIZE) {
        batches++
        break
      }
    }

    // Holds describe availability for a date, so they are worthless once it has passed.
    // Kept independent of the slot sweep: a hold can exist for a date whose slots were
    // already removed, or never generated.
    const removedHolds = await prisma.channelInventoryHold.deleteMany({
      where: { date: { lt: cutoffDate } },
    })
    holdsDeleted = removedHolds.count

    const remaining = await prisma.roomSlot.count({ where: { date: { lt: cutoffDate } } })

    logger.info('cron.prune_past_slots.completed', {
      cutoffDate,
      slotsDeleted,
      holdsDeleted,
      batches,
      // Non-zero means either bookings hold them, or the backlog exceeded one run.
      remainingPastSlots: remaining,
      durationMs: Date.now() - startedAt,
    })

    return NextResponse.json({
      cutoffDate,
      slotsDeleted,
      holdsDeleted,
      batches,
      remainingPastSlots: remaining,
      more: remaining > 0,
    })
  } catch (error) {
    logger.error('cron.prune_past_slots.failed', error, { cutoffDate, slotsDeleted, holdsDeleted })
    return NextResponse.json({ error: 'Failed to prune past slots' }, { status: 500 })
  }
}
