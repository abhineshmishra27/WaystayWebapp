import 'server-only'

import type { ChannelConnection, ChannelSyncKind, ChannelSyncOutcome, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { bookingCoveredDates } from '@/lib/booking-inventory'
import { lockRoomInventory } from '@/lib/booking-inventory-db'
import { resolveLocationFromDatabase } from '@/lib/search-db'
import { generateSlotsForRoom } from '@/lib/slots'
import { adapterForProvider, channelsAreEnabled, withFreshCredentials } from '@/lib/channels/credentials'
import {
  computeHolds,
  dateWindow,
  toHotelFields,
  toRoomFields,
  validatePropertyForImport,
} from '@/lib/channels/mapping'
import type { ChannelAdapter, ExternalRoomType } from '@/lib/channels/types'
import { logger } from '@/lib/logger'

/**
 * Orchestration: transactions, persistence, holds, logging.
 *
 * This layer never parses a provider's wire format - adapters return normalised types
 * and mapping.ts does the translation. Two rules hold throughout:
 *
 *   1. No external HTTP call happens inside a `prisma.$transaction`. Holding row locks
 *      across network I/O is how a slow provider becomes a database outage. Fetch
 *      first, then transact over the result.
 *   2. Every write to a room's availability takes the same advisory lock the booking
 *      path uses, so sync cannot race a customer mid-checkout.
 */

/** How far ahead availability is kept in sync. */
export const AVAILABILITY_WINDOW_DAYS = 120

export class ChannelSyncDisabledError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChannelSyncDisabledError'
  }
}

export async function recordSyncLog(entry: {
  connectionId: string | null
  kind: ChannelSyncKind
  outcome: ChannelSyncOutcome
  message?: string
  eventKey?: string | null
  payload?: Prisma.InputJsonValue
}) {
  try {
    await prisma.channelSyncLog.create({
      data: {
        connectionId: entry.connectionId,
        kind: entry.kind,
        outcome: entry.outcome,
        eventKey: entry.eventKey ?? null,
        message: entry.message?.slice(0, 1000) ?? null,
        payload: entry.payload,
      },
    })
  } catch (error) {
    // The log is observability, not correctness - never let it fail an operation.
    // A unique-violation here is the expected outcome of a duplicate webhook.
    logger.error('lib.channels.sync.failed_to_write_channelsynclog_entry', error)
  }
}

async function markConnectionResult(connectionId: string, error: unknown | null) {
  if (!error) {
    await prisma.channelConnection.update({
      where: { id: connectionId },
      data: { status: 'ACTIVE', lastSyncedAt: new Date(), lastSyncError: null, consecutiveFailures: 0 },
    })
    return
  }

  const message = error instanceof Error ? error.message : String(error)
  await prisma.channelConnection.update({
    where: { id: connectionId },
    data: {
      status: 'ERROR',
      lastSyncError: message.slice(0, 1000),
      consecutiveFailures: { increment: 1 },
    },
  })
}

function assertSyncable(connection: ChannelConnection) {
  if (!channelsAreEnabled()) {
    throw new ChannelSyncDisabledError('Channel syncing is disabled globally (CHANNELS_ENABLED=false)')
  }
  if (!connection.syncEnabled) {
    throw new ChannelSyncDisabledError(`Syncing is switched off for connection ${connection.id}`)
  }
  if (connection.status === 'DISCONNECTED') {
    throw new ChannelSyncDisabledError(`Connection ${connection.id} is disconnected`)
  }
}

/**
 * Imports (or re-imports) a property and its room types.
 *
 * Imported hotels land with `isApproved: false` on first creation. Inventory arriving
 * from a third party is not automatically trusted onto the storefront - an admin
 * approves it, exactly as they would a hotel onboarded directly. Re-imports never
 * re-flip approval, so a later sync cannot silently unpublish or republish a hotel.
 */
export async function importHotelFromConnection(connectionId: string) {
  const connection = await prisma.channelConnection.findUniqueOrThrow({ where: { id: connectionId } })
  assertSyncable(connection)

  try {
    const result = await withFreshCredentials(connectionId, async (credentials, current) => {
      const adapter = adapterFor(current)
      const property = await adapter.getProperty(credentials, current.externalPropertyId)

      const rejections = validatePropertyForImport(property)
      if (rejections.length > 0) {
        throw new Error(
          `Property cannot be imported: ${rejections.map(r => `${r.reason} - ${r.detail}`).join('; ')}`,
        )
      }

      const roomTypes = await adapter.listRoomTypes(credentials, current.externalPropertyId)
      if (roomTypes.length === 0) {
        throw new Error('Property has no room types to import')
      }

      const hotelFields = toHotelFields(property)
      // Resolved outside the transaction: it runs its own queries and the result only
      // affects which canonical location the hotel is filed under.
      const canonicalLocation =
        (hotelFields.pincode ? await resolveLocationFromDatabase(hotelFields.pincode) : null)
        ?? (hotelFields.city ? await resolveLocationFromDatabase(hotelFields.city) : null)

      return persistImport({
        connection: current,
        hotelFields,
        locationId: canonicalLocation?.location.id ?? null,
        roomTypes,
        propertyName: property.name,
        propertyTimezone: property.timezone,
        currency: property.currency,
      })
    })

    await markConnectionResult(connectionId, null)
    await recordSyncLog({
      connectionId,
      kind: 'IMPORT',
      outcome: 'SUCCESS',
      message: `Imported ${result.roomsUpserted} room type(s) into hotel ${result.hotelId}`,
    })
    return result
  } catch (error) {
    await markConnectionResult(connectionId, error)
    await recordSyncLog({
      connectionId,
      kind: 'IMPORT',
      outcome: 'FAILED',
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function adapterFor(connection: ChannelConnection): ChannelAdapter {
  return adapterForProvider(connection.provider)
}

/**
 * Import fields minus the ones a re-sync must never overwrite. Listed explicitly
 * rather than omitted, so adding a field to the mapper is a deliberate decision about
 * whether re-syncing should clobber it.
 */
function contentFieldsOnly(fields: ReturnType<typeof toHotelFields>) {
  return {
    name: fields.name,
    description: fields.description,
    address: fields.address,
    city: fields.city,
    state: fields.state,
    country: fields.country,
    pincode: fields.pincode,
    lat: fields.lat,
    lng: fields.lng,
    checkInTime: fields.checkInTime,
    checkOutTime: fields.checkOutTime,
    amenities: fields.amenities,
  }
}

async function persistImport(input: {
  connection: ChannelConnection
  hotelFields: ReturnType<typeof toHotelFields>
  locationId: string | null
  roomTypes: ExternalRoomType[]
  propertyName: string
  propertyTimezone: string
  currency: string
}) {
  const { connection, hotelFields, locationId, roomTypes } = input

  return prisma.$transaction(async tx => {
    const existingHotel = await tx.hotel.findFirst({
      where: { channelConnectionId: connection.id, externalPropertyId: connection.externalPropertyId },
      select: { id: true },
    })

    const hotel = existingHotel
      ? await tx.hotel.update({
          where: { id: existingHotel.id },
          // Ratings are WayStay's own review data and must survive a re-import, and
          // isApproved/isActive/ownerEnabled are deliberately absent: a re-sync
          // refreshes content, it does not overrule an admin's publish decision.
          data: { ...contentFieldsOnly(hotelFields), locationId },
        })
      : await tx.hotel.create({
          data: {
            ...hotelFields,
            locationId,
            ownerId: connection.ownerId,
            channelConnectionId: connection.id,
            externalPropertyId: connection.externalPropertyId,
            isApproved: false,
            license_number: null,
            gst_number: null,
          },
        })

    let roomsUpserted = 0
    for (const roomType of roomTypes) {
      const roomFields = toRoomFields(roomType)
      const mapping = await tx.channelRoomMapping.findUnique({
        where: {
          connectionId_externalRoomTypeId: {
            connectionId: connection.id,
            externalRoomTypeId: roomType.externalRoomTypeId,
          },
        },
        select: { roomId: true },
      })

      if (mapping) {
        await tx.room.update({ where: { id: mapping.roomId }, data: roomFields })
        await tx.channelRoomMapping.update({
          where: {
            connectionId_externalRoomTypeId: {
              connectionId: connection.id,
              externalRoomTypeId: roomType.externalRoomTypeId,
            },
          },
          data: { externalRatePlanId: roomType.externalRatePlanId },
        })
      } else {
        const room = await tx.room.create({ data: { ...roomFields, hotelId: hotel.id } })
        await tx.channelRoomMapping.create({
          data: {
            connectionId: connection.id,
            externalRoomTypeId: roomType.externalRoomTypeId,
            externalRatePlanId: roomType.externalRatePlanId,
            roomId: room.id,
          },
        })
      }
      roomsUpserted++
    }

    await tx.channelConnection.update({
      where: { id: connection.id },
      data: {
        propertyName: input.propertyName,
        propertyTimezone: input.propertyTimezone || connection.propertyTimezone,
        currency: input.currency || connection.currency,
      },
    })

    return { hotelId: hotel.id, roomsUpserted, created: !existingHotel }
  })
}

export type Overcommitment = {
  roomId: string
  date: string
  inventoryCount: number
  bookedUnits: number
  heldUnits: number
}

/**
 * Finds rooms sold beyond what exists, counting WayStay bookings and channel holds
 * together against the room's inventory.
 *
 * Preventing a double sale outright is not possible: there is an irreducible gap between
 * an OTA selling a room and us being told. What is possible is noticing quickly. This is
 * the detection half of that promise - it answers "did the last sync reveal that we have
 * committed more rooms than we have", which is the only question that matters once the
 * gap has been exploited.
 *
 * Read-only by design. Automatically cancelling a guest's booking to resolve an
 * overcommitment is not a decision code should take.
 */
export async function detectOvercommitment(connectionId: string, dates: string[]): Promise<Overcommitment[]> {
  if (dates.length === 0) return []

  const mappings = await prisma.channelRoomMapping.findMany({
    where: { connectionId },
    select: { roomId: true, room: { select: { inventoryCount: true } } },
  })
  if (mappings.length === 0) return []

  const roomIds = mappings.map(mapping => mapping.roomId)
  const inventoryByRoomId = new Map(mappings.map(mapping => [mapping.roomId, mapping.room.inventoryCount]))

  const [bookings, holds] = await Promise.all([
    prisma.booking.findMany({
      where: {
        status: { in: ['PENDING', 'CONFIRMED'] },
        roomSlot: { roomId: { in: roomIds } },
      },
      select: {
        totalHours: true,
        roomCount: true,
        roomSlot: { select: { roomId: true, date: true, slotType: true, startTime: true, endTime: true } },
      },
    }),
    prisma.channelInventoryHold.findMany({
      where: { roomId: { in: roomIds }, date: { in: dates } },
      select: { roomId: true, date: true, unitsHeld: true },
    }),
  ])

  // A full-day booking occupies every night it spans, not just its start date.
  const bookedByRoomDate = new Map<string, number>()
  for (const booking of bookings) {
    const rooms = Math.max(1, Math.floor(booking.roomCount ?? 1))
    for (const date of bookingCoveredDates(booking)) {
      const key = `${booking.roomSlot.roomId}:${date}`
      bookedByRoomDate.set(key, (bookedByRoomDate.get(key) ?? 0) + rooms)
    }
  }

  const heldByRoomDate = new Map(holds.map(hold => [`${hold.roomId}:${hold.date}`, hold.unitsHeld]))

  const overcommitted: Overcommitment[] = []
  for (const roomId of roomIds) {
    const inventoryCount = inventoryByRoomId.get(roomId) ?? 1
    for (const date of dates) {
      const key = `${roomId}:${date}`
      const bookedUnits = bookedByRoomDate.get(key) ?? 0
      const heldUnits = heldByRoomDate.get(key) ?? 0
      if (bookedUnits + heldUnits > inventoryCount) {
        overcommitted.push({ roomId, date, inventoryCount, bookedUnits, heldUnits })
      }
    }
  }
  return overcommitted
}

/**
 * Pulls the availability calendar and reconciles it into slots and holds.
 *
 * Channel-managed rooms only ever get FULLDAY slots - the provider has no concept of
 * hourly stays, and generating hourly slots would advertise inventory at prices the
 * property never set. Availability itself becomes ChannelInventoryHold rows, because
 * RoomSlot.isBooked is not what the booking path checks for capacity.
 */
export async function syncAvailabilityWindow(connectionId: string, options: { days?: number; startDate?: string } = {}) {
  const connection = await prisma.channelConnection.findUniqueOrThrow({ where: { id: connectionId } })
  assertSyncable(connection)

  const days = Math.max(1, Math.min(365, options.days ?? AVAILABILITY_WINDOW_DAYS))
  const startDate = options.startDate ?? new Date().toISOString().slice(0, 10)
  const dates = dateWindow(startDate, days)
  const endDate = dates[dates.length - 1]

  try {
    const mappings = await prisma.channelRoomMapping.findMany({
      where: { connectionId },
      select: {
        roomId: true,
        externalRoomTypeId: true,
        room: { select: { inventoryCount: true } },
      },
    })
    if (mappings.length === 0) {
      throw new Error('Connection has no mapped rooms - run an import first')
    }

    // Network first, database second. Nothing below holds a lock across this call.
    const availability = await withFreshCredentials(connectionId, (credentials, current) =>
      adapterFor(current).getAvailability(credentials, current.externalPropertyId, startDate, endDate),
    )

    const inventoryByRoomType = new Map(
      mappings.map(mapping => [mapping.externalRoomTypeId, mapping.room.inventoryCount]),
    )
    const roomIdByRoomType = new Map(mappings.map(mapping => [mapping.externalRoomTypeId, mapping.roomId]))
    const holds = computeHolds(availability, inventoryByRoomType)

    const reported = new Set<string>()
    let holdsWritten = 0
    let slotsCreated = 0

    for (const mapping of mappings) {
      const roomHolds = holds.filter(hold => hold.externalRoomTypeId === mapping.externalRoomTypeId)

      slotsCreated += await prisma.$transaction(async tx => {
        await lockRoomInventory(tx, mapping.roomId)

        // One FULLDAY slot per date, so a channel-managed room is bookable at all.
        const slotRows = dates.flatMap(date =>
          generateSlotsForRoom({
            roomId: mapping.roomId,
            date,
            enabledSlotTypes: ['FULLDAY'],
          }),
        )
        const created = await tx.roomSlot.createMany({ data: slotRows, skipDuplicates: true })

        for (const hold of roomHolds) {
          reported.add(`${mapping.roomId}:${hold.date}`)
          await tx.channelInventoryHold.upsert({
            where: { roomId_date: { roomId: mapping.roomId, date: hold.date } },
            create: {
              roomId: mapping.roomId,
              date: hold.date,
              unitsHeld: hold.unitsHeld,
              source: connection.provider,
            },
            update: { unitsHeld: hold.unitsHeld, syncedAt: new Date(), source: connection.provider },
          })
        }

        // Dates the provider did not report inside the window are fully available
        // again; leaving a stale hold there would quietly withhold sellable rooms.
        const unreportedDates = dates.filter(date => !reported.has(`${mapping.roomId}:${date}`))
        if (unreportedDates.length > 0) {
          await tx.channelInventoryHold.deleteMany({
            where: { roomId: mapping.roomId, date: { in: unreportedDates } },
          })
        }

        return created.count
      })

      holdsWritten += roomHolds.length
    }

    await markConnectionResult(connectionId, null)
    await recordSyncLog({
      connectionId,
      kind: 'AVAILABILITY',
      outcome: 'SUCCESS',
      message: `Synced ${dates.length} day(s) across ${mappings.length} room(s): ${holdsWritten} hold(s), ${slotsCreated} new slot(s)`,
    })

    return { rooms: mappings.length, days: dates.length, holdsWritten, slotsCreated, roomIdByRoomType }
  } catch (error) {
    await markConnectionResult(connectionId, error)
    await recordSyncLog({
      connectionId,
      kind: 'AVAILABILITY',
      outcome: 'FAILED',
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
