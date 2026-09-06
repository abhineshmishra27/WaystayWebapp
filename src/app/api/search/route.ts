import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { dateRangeStrings, fullDayStayDates, slotIsUnavailable } from '@/lib/booking-inventory'
import { loadChannelHolds } from '@/lib/booking-inventory-db'
import { slotIsPastForBooking } from '@/lib/booking-time'
import { descendantLocationIds, locationRadiusPlan } from '@/lib/location-search'
import { logger } from '@/lib/logger'
import {
  ROOM_SLOT_SETTING_FIELDS,
  roomAllowsSlotType,
  type CustomerSlotType,
  type RoomSlotSettings,
} from '@/lib/room-slot-settings'
import {
  findHotelBookingPopularity,
  findHotelTextMatches,
  findNearbyHotels,
  resolveLocationFromDatabase,
} from '@/lib/search-db'
import {
  bayesianRating,
  bookingPopularity,
  calculateRelevanceScore,
  distanceRelevance,
  reviewConfidence,
} from '@/lib/search-ranking'

/**
 * How many hotels may enter ranking for a single search.
 *
 * Relevance is decided before the database is asked for hotel detail, not after:
 * geography and text matching produce an ordered candidate list, and only that many
 * hotels are loaded and ranked. Without this the route loaded every approved hotel -
 * with rooms, images and reviews - and paginated the array in memory, which is
 * survivable at 51 hotels and not at a few thousand.
 */
const CANDIDATE_POOL_LIMIT = 300

/**
 * How far back to look for bookings that might still overlap the requested dates.
 *
 * A full-day booking occupies its start date plus however many nights it runs, so one
 * that began before the search window can still consume inventory inside it. The
 * capacity check needs those, but it does not need every booking ever made: without a
 * lower bound this query grows with the lifetime of the business. Thirty days covers
 * any realistic stay; a longer one would have to start more than a month before the
 * dates being searched.
 */
const OVERLAPPING_STAY_LOOKBACK_DAYS = 30

function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

type PricedRoom = RoomSlotSettings & {
  inventoryCount: number
  pricePerHour: number
  price_3h: number
  price_6h: number
  price_12h: number
  priceFullDay: number
}

function roomPriceForSlot(room: PricedRoom, slotType: CustomerSlotType) {
  if (slotType === 'H6') return room.price_6h
  if (slotType === 'H12') return room.price_12h
  if (slotType === 'FULLDAY') return room.priceFullDay
  return room.price_3h
}

function lowestRoomPrice(rooms: PricedRoom[], slotType: CustomerSlotType) {
  const prices = rooms
    .filter(room => roomAllowsSlotType(room, slotType))
    .map(room => roomPriceForSlot(room, slotType))
  return prices.length > 0 ? Math.min(...prices) : null
}

function hotelTextRelevance(match: { matchTier: number; confidence: number } | undefined) {
  if (!match) return 0
  const tierStrength = match.matchTier === 1 ? 1 : match.matchTier <= 4 ? 0.9 : 0.75
  return Math.min(1, Math.max(0, match.confidence * tierStrength))
}

function stayAvailabilityLabel(slotType: CustomerSlotType) {
  if (slotType === 'H6') return 'Available for 6-hour stay'
  if (slotType === 'H12') return 'Available for 12-hour stay'
  if (slotType === 'FULLDAY') return 'Available for full-day stay'
  return 'Available for 3-hour stay'
}

function relevanceDistance(distanceKm: number) {
  if (distanceKm < 0.1) return 'Less than 100 m'
  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url, process.env.NEXTAUTH_URL || 'http://localhost:3000')
    const city = searchParams.get('city')
    const locationId = searchParams.get('locationId')?.trim() || null
    const placeId = searchParams.get('placeId')?.trim() || null
    const latParam = searchParams.get('lat')
    const lngParam = searchParams.get('lng')
    const hasLat = latParam !== null && latParam.trim() !== ''
    const hasLng = lngParam !== null && lngParam.trim() !== ''
    const hasCoords = hasLat && hasLng
    const lat = hasLat ? parseFloat(latParam || '') : null
    const lng = hasLng ? parseFloat(lngParam || '') : null
    const requestedRadius = parseFloat(searchParams.get('radius') || '50')
    const radius = Number.isFinite(requestedRadius) ? Math.min(Math.max(requestedRadius, 1), 250) : 50
    const date = searchParams.get('date')
    const startDate = searchParams.get('startDate') ?? date
    const endDate = searchParams.get('endDate') ?? startDate
    const slotType = searchParams.get('slot') as CustomerSlotType | null
    const roomCount = Math.max(1, Math.min(10, parseInt(searchParams.get('roomCount') || '1', 10) || 1))

    if (hasLat !== hasLng) {
      return NextResponse.json({ error: 'lat and lng are both required' }, { status: 400 })
    }
    if (hasCoords && (lat === null || Number.isNaN(lat) || lat < -90 || lat > 90)) {
      return NextResponse.json({ error: 'Invalid lat' }, { status: 400 })
    }
    if (hasCoords && (lng === null || Number.isNaN(lng) || lng < -180 || lng > 180)) {
      return NextResponse.json({ error: 'Invalid lng' }, { status: 400 })
    }
    const requestedPage = parseInt(searchParams.get('page') || '1', 10)
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const requestedLimit = parseInt(searchParams.get('limit') || '20', 10)
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20
    const minRatingParam = searchParams.get('minRating')
    const minRating = minRatingParam === null ? null : parseFloat(minRatingParam)
    if (minRating !== null && (!Number.isFinite(minRating) || minRating < 0 || minRating > 5)) {
      return NextResponse.json({ error: 'minRating must be between 0 and 5' }, { status: 400 })
    }
    const skip = (page - 1) * limit
    const distanceByHotelId = new Map<string, number>()
    const locations = city || locationId
      ? await prisma.location.findMany({
          select: {
            id: true,
            name: true,
            normalizedName: true,
            type: true,
            parentLocationId: true,
            latitude: true,
            longitude: true,
            radiusKm: true,
            aliases: { select: { alias: true, normalizedAlias: true } },
          },
        })
      : []
    const locationById = new Map(locations.map(location => [location.id, location]))
    const selectedLocation = locationId ? locations.find(location => location.id === locationId) : null
    if (locationId && !selectedLocation) {
      return NextResponse.json({ error: 'Unknown locationId' }, { status: 400 })
    }
    const locationResolution = selectedLocation
      ? {
          location: selectedLocation,
          matchedText: selectedLocation.name,
          matchedBy: 'CANONICAL' as const,
          matchTier: 2,
          score: 1,
        }
      : city && !placeId
        ? await resolveLocationFromDatabase(city)
        : null
    const hotelTextMatches = placeId
      ? [{ hotelId: placeId, matchTier: 1, confidence: 1 }]
      : city
        ? await findHotelTextMatches(city)
        : []
    const hotelTextMatchById = new Map(hotelTextMatches.map(match => [match.hotelId, match]))
    const exactHotelIds = new Set(
      hotelTextMatches.filter(match => match.matchTier === 1).map(match => match.hotelId),
    )
    const directHotelIds = locationId ? new Set<string>() : exactHotelIds
    const radiusPlan = locationResolution
      ? locationRadiusPlan(locationResolution.location.type, locationResolution.location.radiusKm)
      : null
    const [locationNearbyHotels, coordinateNearbyHotels] = await Promise.all([
      locationResolution && radiusPlan
        ? findNearbyHotels(
            locationResolution.location.latitude,
            locationResolution.location.longitude,
            radiusPlan.expandedKm,
            CANDIDATE_POOL_LIMIT,
          )
        : Promise.resolve([]),
      hasCoords && lat !== null && lng !== null
        ? findNearbyHotels(lat, lng, radius, CANDIDATE_POOL_LIMIT)
        : Promise.resolve([]),
    ])

    const locationNearbyIds = new Set(locationNearbyHotels.map(match => match.hotelId))
    const coordinateNearbyIds = new Set(coordinateNearbyHotels.map(match => match.hotelId))
    for (const match of locationNearbyHotels) distanceByHotelId.set(match.hotelId, match.distanceKm)
    if (hasCoords) {
      for (const match of coordinateNearbyHotels) distanceByHotelId.set(match.hotelId, match.distanceKm)
    }

    let candidateHotelIds: string[] | null = null
    if (locationResolution) {
      candidateHotelIds = [...new Set([...locationNearbyIds, ...directHotelIds])]
    } else if (hotelTextMatches.length > 0) {
      candidateHotelIds = hotelTextMatches.map(match => match.hotelId)
    }
    if (hasCoords) {
      candidateHotelIds = candidateHotelIds === null
        ? [...coordinateNearbyIds]
        : candidateHotelIds.filter(hotelId => coordinateNearbyIds.has(hotelId))
    }

    // Trim to the pool limit with exact name matches first, so capping can never drop
    // the hotel someone searched for by name in favour of a merely nearby one.
    let candidatePoolCapped = false
    if (candidateHotelIds !== null && candidateHotelIds.length > CANDIDATE_POOL_LIMIT) {
      const exactFirst = [
        ...candidateHotelIds.filter(hotelId => directHotelIds.has(hotelId)),
        ...candidateHotelIds.filter(hotelId => !directHotelIds.has(hotelId)),
      ]
      candidateHotelIds = exactFirst.slice(0, CANDIDATE_POOL_LIMIT)
      candidatePoolCapped = true
    }

    // Only rooms that can serve the requested stay type are worth loading. A
    // night-fare-only room has no slot-wise (transit) inventory at all, so pulling it
    // into an hourly search costs rows and can never yield a bookable result - and the
    // reverse for a slot-only room in a full-day search.
    const enabledFieldForSlot = slotType && slotType in ROOM_SLOT_SETTING_FIELDS
      ? ROOM_SLOT_SETTING_FIELDS[slotType]
      : null
    const roomWhere: Prisma.RoomWhereInput = {
      isActive: true,
      available: true,
      ...(enabledFieldForSlot ? { [enabledFieldForSlot]: true } : {}),
    }

    const hotels = await prisma.hotel.findMany({
      where: {
        isApproved: true,
        isActive: true,
        ownerEnabled: true,
        // A hotel with no room that can serve the requested stay type is not a result.
        // Excluding it here means it is never loaded, rather than loaded and discarded.
        rooms: { some: roomWhere },
        ...(candidateHotelIds !== null
          ? { id: { in: candidateHotelIds } }
          : city && !locationId && !placeId && !locationResolution && hotelTextMatches.length === 0
          ? { city: { contains: city, mode: 'insensitive' } }
          : {}),
      },
      include: {
        // Images and the Location join are deliberately absent. Rooms are needed for
        // every candidate because availability and pricing decide who is in the
        // results at all, but a thumbnail is only ever shown for the page being
        // returned - so it is fetched after pagination, for those hotels only.
        // Location is resolved from the `locations` already in memory.
        rooms: {
          where: roomWhere,
          select: {
            id: true,
            inventoryCount: true,
            pricePerHour: true,
            price_3h: true,
            price_6h: true,
            price_12h: true,
            priceFullDay: true,
            threeHourEnabled: true,
            sixHourEnabled: true,
            twelveHourEnabled: true,
            nightStayEnabled: true,
          },
          orderBy: { price_3h: 'asc' },
        },
      },
      // Safety net for the browse-all case, where no geography or text query has
      // already bounded the pool. Ordered so the cap is deterministic.
      take: CANDIDATE_POOL_LIMIT,
      orderBy: [{ rating_avg: 'desc' }, { id: 'asc' }],
    })

    // Aggregated in the database rather than by loading every review row. Note
    // Hotel.rating_avg is a manually entered star rating, not a maintained average of
    // reviews, so it stays the fallback for hotels that have no reviews yet.
    const reviewStatsByHotelId = new Map<string, { average: number; count: number }>()
    if (hotels.length > 0) {
      const grouped = await prisma.review.groupBy({
        by: ['hotelId'],
        where: { hotelId: { in: hotels.map(hotel => hotel.id) }, status: 'PUBLISHED' },
        _avg: { rating: true },
        _count: { _all: true },
      })
      for (const row of grouped) {
        reviewStatsByHotelId.set(row.hotelId, {
          average: row._avg.rating ?? 0,
          count: row._count._all,
        })
      }
    }

    const ratingByHotelId = new Map(
      hotels.map(hotel => {
        const stats = reviewStatsByHotelId.get(hotel.id)
        return [hotel.id, stats && stats.count > 0 ? stats.average : hotel.rating_avg]
      }),
    )

    // Room-level and hotel-level filtering already happened in SQL above.
    let filteredHotels = hotels
    if (startDate && endDate && slotType) {
      const now = new Date()
      const roomIds = filteredHotels.flatMap(hotel => hotel.rooms.map(room => room.id))
      const requestedDates = slotType === 'FULLDAY' ? fullDayStayDates(startDate, endDate) : [startDate]
      // One day past the range so overnight hourly slots still see the next day's holds.
      const holdRangeEnd = new Date(
        Date.parse(`${slotType === 'FULLDAY' ? endDate : startDate}T00:00:00Z`) + 86_400_000,
      ).toISOString().slice(0, 10)
      const [matchingSlots, activeBookings, channelHoldsByRoomId] = roomIds.length > 0
        ? await Promise.all([
            prisma.roomSlot.findMany({
              where: {
                roomId: { in: roomIds },
                date: { gte: startDate, lte: slotType === 'FULLDAY' ? endDate : startDate },
                slotType,
              },
              select: { roomId: true, date: true, slotType: true, startTime: true, endTime: true, isBooked: true },
            }),
            prisma.booking.findMany({
              where: {
                status: { in: ['PENDING', 'CONFIRMED'] },
                roomSlot: {
                  roomId: { in: roomIds },
                  // Bounded so this does not grow with every booking ever taken. The
                  // lower bound still catches a long stay that began before the window.
                  date: {
                    gte: shiftDate(startDate, -OVERLAPPING_STAY_LOOKBACK_DAYS),
                    lte: slotType === 'FULLDAY' ? endDate : startDate,
                  },
                },
              },
              select: {
                totalHours: true,
                roomCount: true,
                roomSlot: { select: { roomId: true, date: true, slotType: true, startTime: true, endTime: true } },
              },
            }),
            loadChannelHolds(prisma, roomIds, dateRangeStrings(startDate, holdRangeEnd)),
          ])
        : [[], [], new Map()]

      const slotsByRoomId = new Map<string, typeof matchingSlots>()
      for (const candidate of matchingSlots) {
        const roomSlots = slotsByRoomId.get(candidate.roomId) || []
        roomSlots.push(candidate)
        slotsByRoomId.set(candidate.roomId, roomSlots)
      }

      const bookingsByRoomId = new Map<string, typeof activeBookings>()
      for (const booking of activeBookings) {
        const roomBookings = bookingsByRoomId.get(booking.roomSlot.roomId) || []
        roomBookings.push(booking)
        bookingsByRoomId.set(booking.roomSlot.roomId, roomBookings)
      }

      const availableHotelIds = new Set<string>()
      for (const hotel of filteredHotels) {
        const hotelHasAvailability = hotel.rooms.some(room => {
          if (!roomAllowsSlotType(room, slotType)) return false
          const roomSlots = slotsByRoomId.get(room.id) || []
          const roomBookings = bookingsByRoomId.get(room.id) || []
          const startCandidates = roomSlots.filter(candidate => candidate.date === startDate)

          return startCandidates.some(candidate => {
            if (slotIsPastForBooking(candidate.slotType, candidate.date, candidate.startTime, now)) return false
            const hasEveryDate = requestedDates.every(date => roomSlots.some(slot =>
              slot.date === date && slot.startTime === candidate.startTime && slot.endTime === candidate.endTime
            ))
            return hasEveryDate && !slotIsUnavailable(
              candidate,
              roomBookings,
              slotType === 'FULLDAY' ? endDate : candidate.date,
              room.inventoryCount,
              roomCount,
              channelHoldsByRoomId.get(room.id) ?? [],
            )
          })
        })

        if (hotelHasAvailability) {
          availableHotelIds.add(hotel.id)
        }
      }
      filteredHotels = filteredHotels.filter(hotel => availableHotelIds.has(hotel.id))
    }

    if (minRating !== null) {
      filteredHotels = filteredHotels.filter(hotel => (ratingByHotelId.get(hotel.id) ?? 0) >= minRating)
    }

    let searchRadius: {
      initialKm: number
      appliedKm: number
      expanded: boolean
      attemptedExpansion: boolean
      locationName: string
      noResultsWithinInitial: boolean
    } | null = null

    if (locationResolution && radiusPlan && !hasCoords) {
      const availableExactHotel = filteredHotels.some(hotel => directHotelIds.has(hotel.id))
      const initialGeographicHotels = filteredHotels.filter(
        hotel => (distanceByHotelId.get(hotel.id) ?? Infinity) <= radiusPlan.initialKm,
      )
      const expandedGeographicHotels = filteredHotels.filter(
        hotel => (distanceByHotelId.get(hotel.id) ?? Infinity) <= radiusPlan.expandedKm,
      )
      const attemptedExpansion = !availableExactHotel && initialGeographicHotels.length === 0
      const expanded = attemptedExpansion && expandedGeographicHotels.length > 0

      filteredHotels = filteredHotels.filter(hotel =>
        directHotelIds.has(hotel.id)
        || (distanceByHotelId.get(hotel.id) ?? Infinity) <= (
          attemptedExpansion ? radiusPlan.expandedKm : radiusPlan.initialKm
        ),
      )
      searchRadius = {
        initialKm: radiusPlan.initialKm,
        appliedKm: attemptedExpansion ? radiusPlan.expandedKm : radiusPlan.initialKm,
        expanded,
        attemptedExpansion,
        locationName: locationResolution.location.name,
        noResultsWithinInitial: !availableExactHotel && initialGeographicHotels.length === 0,
      }
    }

    const availableHotelIds = filteredHotels.map(hotel => hotel.id)
    const [globalReviewStats, bookingCountByHotelId] = await Promise.all([
      prisma.review.aggregate({
        where: { status: 'PUBLISHED' },
        _avg: { rating: true },
      }),
      findHotelBookingPopularity(availableHotelIds),
    ])
    const globalRatingMean = globalReviewStats._avg.rating ?? 4
    const highestBookingCount = Math.max(0, ...bookingCountByHotelId.values())
    const matchingLocationIds = locationResolution
      ? descendantLocationIds(locations, locationResolution.location.id)
      : new Set<string>()
    const appliedRadiusKm = hasCoords
      ? radius
      : searchRadius?.appliedKm ?? radiusPlan?.initialKm ?? radius
    const rankingByHotelId = new Map<string, {
      relevanceScore: number
      bayesianRating: number
      relevanceReasons: string[]
    }>()

    for (const hotel of filteredHotels) {
      const distance = distanceByHotelId.get(hotel.id) ?? null
      const reviewCount = Math.max(reviewStatsByHotelId.get(hotel.id)?.count ?? 0, hotel.total_review)
      const averageRating = ratingByHotelId.get(hotel.id) ?? globalRatingMean
      const qualityRating = bayesianRating(averageRating, reviewCount, globalRatingMean)
      const bookingCount = bookingCountByHotelId.get(hotel.id) ?? 0
      let locationMatch = hasCoords ? 1 : 0

      if (locationResolution) {
        if (hotel.locationId === locationResolution.location.id) {
          locationMatch = 1
        } else if (hotel.locationId && matchingLocationIds.has(hotel.locationId)) {
          locationMatch = 0.9
        } else if (distance !== null) {
          locationMatch = 0.8 * locationResolution.score
        }
      }

      const relevanceScore = calculateRelevanceScore({
        locationMatch,
        hotelTextMatch: hotelTextRelevance(hotelTextMatchById.get(hotel.id)),
        distance: distanceRelevance(distance, appliedRadiusKm),
        ratingQuality: qualityRating / 5,
        reviewConfidence: reviewConfidence(reviewCount),
        bookingPopularity: bookingPopularity(bookingCount, highestBookingCount),
      })
      // Resolved from the locations already in memory rather than a join on every
      // candidate row. Only populated when a location query was made, which is also
      // the only branch below that reads it.
      const hotelLocation = hotel.locationId ? locationById.get(hotel.locationId) : undefined
      const relevanceReasons: string[] = []

      if (hasCoords && distance !== null) {
        relevanceReasons.push(`${relevanceDistance(distance)} from your location`)
      } else if (locationResolution) {
        const target = locationResolution.location
        if (target.type === 'LOCALITY' && hotel.locationId === target.id) {
          relevanceReasons.push(`In ${target.name}`)
        } else if (target.type === 'LANDMARK' || target.type === 'AIRPORT') {
          relevanceReasons.push(
            distance === null
              ? `Near ${target.name}`
              : `Near ${target.name} · ${relevanceDistance(distance)} away`,
          )
        } else if (
          target.type === 'CITY'
          && hotelLocation?.type === 'LOCALITY'
          && matchingLocationIds.has(hotelLocation.id)
        ) {
          relevanceReasons.push(`In ${hotelLocation.name}`)
        } else if (distance !== null) {
          relevanceReasons.push(`${relevanceDistance(distance)} from ${target.name}`)
        }
      }

      if (startDate && endDate && slotType) {
        relevanceReasons.push(stayAvailabilityLabel(slotType))
      }
      rankingByHotelId.set(hotel.id, {
        relevanceScore,
        bayesianRating: qualityRating,
        relevanceReasons,
      })
    }

    filteredHotels.sort((first, second) => {
      const firstRanking = rankingByHotelId.get(first.id)!
      const secondRanking = rankingByHotelId.get(second.id)!
      if (firstRanking.relevanceScore !== secondRanking.relevanceScore) {
        return secondRanking.relevanceScore - firstRanking.relevanceScore
      }
      const distanceDifference = (distanceByHotelId.get(first.id) ?? Infinity)
        - (distanceByHotelId.get(second.id) ?? Infinity)
      if (distanceDifference !== 0) return distanceDifference
      return secondRanking.bayesianRating - firstRanking.bayesianRating
    })

    const totalCount = filteredHotels.length
    const paginatedHotels = filteredHotels.slice(skip, skip + limit)

    // Thumbnails for the page being returned only. Ranking needs rooms for every
    // candidate, but nothing needs an image until a hotel has earned a place on the
    // page, so this scales with page size rather than with the candidate pool.
    const imageByHotelId = new Map<string, string>()
    if (paginatedHotels.length > 0) {
      const images = await prisma.hotelImage.findMany({
        where: { hotelId: { in: paginatedHotels.map(hotel => hotel.id) } },
        select: { hotelId: true, url: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      })
      for (const image of images) {
        if (!imageByHotelId.has(image.hotelId)) imageByHotelId.set(image.hotelId, image.url)
      }
    }

    const result = paginatedHotels.map(hotel => {
      const selectedSlotPrice = lowestRoomPrice(hotel.rooms, slotType ?? 'H3')
      const hourlyPrices = hotel.rooms.map(room => room.pricePerHour)
      const stayCount = slotType === 'FULLDAY' && startDate && endDate
        ? Math.max(1, fullDayStayDates(startDate, endDate).length)
        : 1

      return {
      relevanceScore: rankingByHotelId.get(hotel.id)?.relevanceScore ?? 0,
      relevanceReasons: rankingByHotelId.get(hotel.id)?.relevanceReasons ?? [],
      bayesianRating: Number((rankingByHotelId.get(hotel.id)?.bayesianRating ?? 0).toFixed(2)),
      selectedSlotPrice: selectedSlotPrice ? selectedSlotPrice * roomCount * stayCount : null,
      id: hotel.id,
      name: hotel.name,
      city: hotel.city,
      state: hotel.state,
      distanceKm: distanceByHotelId.has(hotel.id) ? Number((distanceByHotelId.get(hotel.id) || 0).toFixed(1)) : null,
      lat: hotel.lat,
      lng: hotel.lng,
      image: imageByHotelId.get(hotel.id) ?? null,
      avgRating: ratingByHotelId.get(hotel.id) ?? 0,
      reviewCount: reviewStatsByHotelId.get(hotel.id)?.count || hotel.total_review,
      pricePerHour: hourlyPrices.length > 0 ? Math.min(...hourlyPrices) : null,
      price3h: lowestRoomPrice(hotel.rooms, 'H3'),
      price6h: lowestRoomPrice(hotel.rooms, 'H6'),
      price12h: lowestRoomPrice(hotel.rooms, 'H12'),
      priceFullDay: lowestRoomPrice(hotel.rooms, 'FULLDAY'),
    }
    })

    const parentLocation = locationResolution?.location.parentLocationId
      ? locations.find(location => location.id === locationResolution.location.parentLocationId)
      : null

    return NextResponse.json({
      hotels: result,
      count: totalCount,
      page,
      // `count` is the number of relevant candidates considered, not every hotel that
      // could conceivably match. When the pool was capped, say so rather than letting
      // the UI present a truncated number as a complete total.
      candidatePool: {
        limit: CANDIDATE_POOL_LIMIT,
        capped: candidatePoolCapped || hotels.length >= CANDIDATE_POOL_LIMIT,
      },
      searchRadius,
      resolvedLocation: locationResolution
        ? {
            id: locationResolution.location.id,
            name: locationResolution.location.name,
            type: locationResolution.location.type,
            parentName: parentLocation?.name ?? null,
            matchedText: locationResolution.matchedText,
            matchedBy: locationResolution.matchedBy,
            confidence: Number(locationResolution.score.toFixed(3)),
          }
        : null,
    })
  } catch (error) {
    logger.error('api.search.search_error', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
