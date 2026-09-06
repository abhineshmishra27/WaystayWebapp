import 'server-only'

import type { ChannelConnection, ChannelSyncKind, ChannelSyncOutcome, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { bookingCoveredDates } from '@/lib/booking-inventory'
import { lockRoomInventory } from '@/lib/booking-inventory-db'
import { PLATFORM_CURRENCY } from '@/lib/money'
import { ingestImages, type IngestedImage } from '@/lib/channels/images'
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

      // Re-hosted before the transaction opens: this talks to Cloudinary, which fetches
      // each photograph from the provider, and network calls do not belong inside a
      // transaction. A property with no usable images simply yields none.
      const hotelImages = await ingestImages(
        property.imageUrls,
        `${current.provider}-${current.externalPropertyId}-hotel`,
      )
      const roomImagesByRoomType = new Map<string, string[]>()
      for (const roomType of roomTypes) {
        const ingested = await ingestImages(
          roomType.imageUrls,
          `${current.provider}-${current.externalPropertyId}-room-${roomType.externalRoomTypeId}`,
        )
        roomImagesByRoomType.set(roomType.externalRoomTypeId, ingested.map(image => image.url))
      }

      return persistImport({
        connection: current,
        hotelFields,
        locationId: canonicalLocation?.location.id ?? null,
        roomTypes,
        hotelImages,
        roomImagesByRoomType,
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
  hotelImages: IngestedImage[]
  roomImagesByRoomType: Map<string, string[]>
  propertyName: string
  propertyTimezone: string
  currency: string
}) {
  const { connection, hotelFields, locationId, roomTypes, hotelImages, roomImagesByRoomType } = input

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

    // Upserted by publicId, which is derived from the connection and the source index,
    // so a re-import refreshes the same rows instead of stacking duplicates on a
    // listing every time the property syncs.
    for (const [index, image] of hotelImages.entries()) {
      const existingImage = await tx.hotelImage.findFirst({
        where: { hotelId: hotel.id, publicId: image.publicId },
        select: { id: true },
      })
      if (existingImage) {
        await tx.hotelImage.update({
          where: { id: existingImage.id },
          data: { url: image.url, sortOrder: index },
        })
      } else {
        await tx.hotelImage.create({
          data: { hotelId: hotel.id, url: image.url, publicId: image.publicId, sortOrder: index },
        })
      }
    }

    let roomsUpserted = 0
    for (const roomType of roomTypes) {
      const roomFields = {
        ...toRoomFields(roomType),
        // Prefer the re-hosted URLs; the provider's own links would not render.
        images: roomImagesByRoomType.get(roomType.externalRoomTypeId) ?? [],
      }
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

/**
 * Attempts before a push is abandoned. Generous, because the alternative to retrying is
 * a partner who believes a room is free while a guest is holding a paid booking for it.
 */
const MAX_PUSH_ATTEMPTS = 6
const PUSH_BACKOFF_BASE_MS = 60_000

/** 1m, 2m, 4m, 8m, 16m, 32m - fast enough to catch a blip, slow enough not to hammer. */
function nextRetryDelayMs(attempts: number) {
  return PUSH_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempts - 1))
}

function toDateString(value: Date) {
  return value.toISOString().slice(0, 10)
}

export type PushResult =
  | { status: 'SKIPPED'; reason: string }
  | { status: 'PUSHED'; externalReservationId: string }
  | { status: 'FAILED' | 'ABANDONED'; error: string }

/**
 * Tells the channel about a booking WayStay has taken.
 *
 * Without this the integration is one-way: WayStay would sell imported inventory and
 * the partner would go on offering the same room, which is the exact double sale the
 * whole design exists to prevent.
 *
 * Idempotent by construction. The provider is given `thirdPartyIdentifier = booking.id`,
 * so a retry after an ambiguous failure cannot create a second reservation, and a
 * booking already marked PUSHED short-circuits before any call is made.
 *
 * Never throws at the caller. A push failure must not turn into a failed payment
 * confirmation for a guest who has already paid - it is recorded for retry instead.
 */
export async function pushBookingToChannel(bookingId: string): Promise<PushResult> {
  if (!channelsAreEnabled()) return { status: 'SKIPPED', reason: 'channels disabled' }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      channelPush: true,
      roomSlot: {
        include: {
          room: {
            include: {
              channelMapping: true,
              hotel: { select: { id: true, channelConnectionId: true } },
            },
          },
        },
      },
    },
  })

  if (!booking) return { status: 'SKIPPED', reason: 'booking not found' }

  const connectionId = booking.roomSlot.room.hotel.channelConnectionId
  const mapping = booking.roomSlot.room.channelMapping
  // The overwhelmingly common case: an ordinary WayStay hotel, nothing to tell anyone.
  if (!connectionId || !mapping) return { status: 'SKIPPED', reason: 'not channel-managed' }

  if (booking.channelPush?.pushStatus === 'PUSHED' && booking.channelPush.externalReservationId) {
    return { status: 'PUSHED', externalReservationId: booking.channelPush.externalReservationId }
  }
  if (booking.channelPush?.pushStatus === 'ABANDONED') {
    return { status: 'SKIPPED', reason: 'previously abandoned; needs manual reconciliation' }
  }

  const attempts = (booking.channelPush?.pushAttempts ?? 0) + 1

  try {
    // Network first: holding a row lock across a provider call is how a slow partner
    // becomes a database outage.
    const reservation = await withFreshCredentials(connectionId, (credentials, connection) =>
      adapterFor(connection).createReservation(credentials, connection.externalPropertyId, {
        externalRoomTypeId: mapping.externalRoomTypeId,
        externalRatePlanId: mapping.externalRatePlanId,
        idempotencyKey: booking.id,
        checkInDate: toDateString(booking.checkIn),
        checkOutDate: toDateString(booking.checkOut),
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        guestPhone: booking.guestPhone,
        guestCount: booking.guestCount,
        roomCount: booking.roomCount,
        totalAmount: Number(booking.totalAmount),
        currency: PLATFORM_CURRENCY,
      }),
    )

    await prisma.channelBookingMapping.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId: booking.id,
        connectionId,
        externalReservationId: reservation.externalReservationId,
        pushStatus: 'PUSHED',
        pushAttempts: attempts,
        lastPushedAt: new Date(),
        nextRetryAt: null,
        lastPushError: null,
      },
      update: {
        externalReservationId: reservation.externalReservationId,
        pushStatus: 'PUSHED',
        pushAttempts: attempts,
        lastPushedAt: new Date(),
        nextRetryAt: null,
        lastPushError: null,
      },
    })

    await recordSyncLog({
      connectionId,
      kind: 'PUSH',
      outcome: 'SUCCESS',
      message: `Booking ${booking.id} pushed as reservation ${reservation.externalReservationId}`,
    })
    return { status: 'PUSHED', externalReservationId: reservation.externalReservationId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const exhausted = attempts >= MAX_PUSH_ATTEMPTS
    const pushStatus = exhausted ? 'ABANDONED' : 'FAILED'

    await prisma.channelBookingMapping.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId: booking.id,
        connectionId,
        pushStatus,
        pushAttempts: attempts,
        lastPushError: message.slice(0, 1000),
        nextRetryAt: exhausted ? null : new Date(Date.now() + nextRetryDelayMs(attempts)),
      },
      update: {
        pushStatus,
        pushAttempts: attempts,
        lastPushError: message.slice(0, 1000),
        nextRetryAt: exhausted ? null : new Date(Date.now() + nextRetryDelayMs(attempts)),
      },
    })

    await recordSyncLog({
      connectionId,
      kind: 'PUSH',
      // Abandoned is a real failure needing a person; a retryable one is only partial.
      outcome: exhausted ? 'FAILED' : 'PARTIAL',
      message: `Booking ${booking.id} push attempt ${attempts} failed: ${message}`,
    })
    logger.error('channels.push.failed', error, { bookingId: booking.id, attempts, exhausted })

    return { status: pushStatus, error: message }
  }
}

/**
 * Tells the channel a booking is no longer happening.
 *
 * Without it a cancelled WayStay booking would hold a partner's room forever - the
 * mirror image of the double sale, and just as costly to them.
 */
export async function cancelBookingOnChannel(bookingId: string): Promise<PushResult> {
  if (!channelsAreEnabled()) return { status: 'SKIPPED', reason: 'channels disabled' }

  const mapping = await prisma.channelBookingMapping.findUnique({ where: { bookingId } })
  // Nothing was ever pushed, so there is nothing to retract.
  if (!mapping?.externalReservationId) return { status: 'SKIPPED', reason: 'never pushed' }
  if (mapping.pushStatus === 'CANCELLED') {
    return { status: 'SKIPPED', reason: 'already cancelled on the channel' }
  }

  try {
    await withFreshCredentials(mapping.connectionId, (credentials, connection) =>
      adapterFor(connection).cancelReservation(
        credentials,
        connection.externalPropertyId,
        mapping.externalReservationId as string,
      ),
    )

    await prisma.channelBookingMapping.update({
      where: { bookingId },
      data: { pushStatus: 'CANCELLED', lastPushedAt: new Date(), lastPushError: null, nextRetryAt: null },
    })
    await recordSyncLog({
      connectionId: mapping.connectionId,
      kind: 'PUSH',
      outcome: 'SUCCESS',
      message: `Booking ${bookingId} cancelled on the channel`,
    })
    return { status: 'PUSHED', externalReservationId: mapping.externalReservationId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // CANCEL_FAILED rather than FAILED: the partner is still holding a room for a stay
    // that is not happening, which is a different problem from a push that never landed.
    await prisma.channelBookingMapping.update({
      where: { bookingId },
      data: { pushStatus: 'CANCEL_FAILED', lastPushError: message.slice(0, 1000) },
    })
    await recordSyncLog({
      connectionId: mapping.connectionId,
      kind: 'PUSH',
      outcome: 'FAILED',
      message: `Booking ${bookingId} could not be cancelled on the channel: ${message}`,
    })
    logger.error('channels.cancel.failed', error, { bookingId })
    return { status: 'FAILED', error: message }
  }
}

/**
 * Fire-and-forget wrapper for the payment-confirmation paths.
 *
 * `pushBookingToChannel` handles provider failures itself, but the lookup before it can
 * still throw if the database hiccups. A guest who has paid must not see their
 * confirmation fail because we could not tell a partner about it, so everything is
 * swallowed here and left for the retry sweep. Existing at all means the four
 * confirmation sites stay one line each and cannot each get the guarantee subtly wrong.
 */
export async function notifyChannelOfConfirmedBooking(bookingId: string) {
  try {
    await pushBookingToChannel(bookingId)
  } catch (error) {
    logger.error('channels.push.unexpected', error, { bookingId })
  }
}

/** Same guarantee for the cancellation paths. */
export async function notifyChannelOfCancelledBooking(bookingId: string) {
  try {
    await cancelBookingOnChannel(bookingId)
  } catch (error) {
    logger.error('channels.cancel.unexpected', error, { bookingId })
  }
}

/**
 * Re-attempts pushes that failed and are due. Called from the reconciliation cron, so a
 * transient provider outage resolves itself without anyone watching.
 */
export async function retryDuePushes(limit = 25) {
  if (!channelsAreEnabled()) return { attempted: 0, pushed: 0, stillFailing: 0 }

  const due = await prisma.channelBookingMapping.findMany({
    where: { pushStatus: 'FAILED', nextRetryAt: { lte: new Date() } },
    select: { bookingId: true },
    orderBy: { nextRetryAt: 'asc' },
    take: limit,
  })

  let pushed = 0
  for (const entry of due) {
    const result = await pushBookingToChannel(entry.bookingId)
    if (result.status === 'PUSHED') pushed++
  }
  return { attempted: due.length, pushed, stillFailing: due.length - pushed }
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
