import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { fullDayStayDates, slotIsUnavailable } from '@/lib/booking-inventory'
import { slotIsPastForBooking } from '@/lib/booking-time'
import { descendantLocationIds, locationRadiusPlan } from '@/lib/location-search'
import { roomAllowsSlotType, type CustomerSlotType, type RoomSlotSettings } from '@/lib/room-slot-settings'
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
          )
        : Promise.resolve([]),
      hasCoords && lat !== null && lng !== null
        ? findNearbyHotels(lat, lng, radius)
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

    const hotels = await prisma.hotel.findMany({
      where: {
        isApproved: true,
        isActive: true,
        ownerEnabled: true,
        ...(candidateHotelIds !== null
          ? { id: { in: candidateHotelIds } }
          : city && !locationId && !placeId && !locationResolution && hotelTextMatches.length === 0
          ? { city: { contains: city, mode: 'insensitive' } }
          : {}),
      },
      include: {
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
        reviews: { where: { status: 'PUBLISHED' }, select: { rating: true } },
        location: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        rooms: {
          where: { isActive: true, available: true },
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
    })

    const ratingByHotelId = new Map(
      hotels.map(hotel => [
        hotel.id,
        hotel.reviews.length > 0
          ? hotel.reviews.reduce((sum, review) => sum + review.rating, 0) / hotel.reviews.length
          : hotel.rating_avg,
      ]),
    )

    let filteredHotels = hotels.filter(hotel => hotel.rooms.some(
      room => !slotType || roomAllowsSlotType(room, slotType),
    ))
    if (startDate && endDate && slotType) {
      const now = new Date()
      const roomIds = filteredHotels.flatMap(hotel => hotel.rooms.map(room => room.id))
      const requestedDates = slotType === 'FULLDAY' ? fullDayStayDates(startDate, endDate) : [startDate]
      const [matchingSlots, activeBookings] = roomIds.length > 0
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
                roomSlot: { roomId: { in: roomIds } },
              },
              select: {
                totalHours: true,
                roomCount: true,
                roomSlot: { select: { roomId: true, date: true, slotType: true, startTime: true, endTime: true } },
              },
            }),
          ])
        : [[], []]

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
      const reviewCount = Math.max(hotel.reviews.length, hotel.total_review)
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
          && hotel.location?.type === 'LOCALITY'
          && matchingLocationIds.has(hotel.location.id)
        ) {
          relevanceReasons.push(`In ${hotel.location.name}`)
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
      image: hotel.images[0]?.url || null,
      avgRating: ratingByHotelId.get(hotel.id) ?? 0,
      reviewCount: hotel.reviews.length || hotel.total_review,
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
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
