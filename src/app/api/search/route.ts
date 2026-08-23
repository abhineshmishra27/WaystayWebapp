import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { bookingConflictsWithRequest, dateRangeStrings } from '@/lib/booking-inventory'
import { slotIsPastForBooking } from '@/lib/booking-time'
import { roomAllowsSlotType, type CustomerSlotType, type RoomSlotSettings } from '@/lib/room-slot-settings'

type PricedRoom = RoomSlotSettings & {
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

function distanceKm(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  const earthRadiusKm = 6371
  const dLat = ((toLat - fromLat) * Math.PI) / 180
  const dLng = ((toLng - fromLng) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((fromLat * Math.PI) / 180) *
      Math.cos((toLat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusKm * c
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url, process.env.NEXTAUTH_URL || 'http://localhost:3000')
    const city = searchParams.get('city')
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

    let hotels = await prisma.hotel.findMany({
      where: {
        isApproved: true,
        isActive: true,
        ownerEnabled: true,
        ...(city ? { city: { contains: city, mode: 'insensitive' } } : {}),
      },
      include: {
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
        reviews: { where: { status: 'PUBLISHED' }, select: { rating: true } },
        rooms: {
          where: { isActive: true, available: true },
          select: {
            id: true,
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

    if (hasCoords && lat !== null && lng !== null) {
      hotels = hotels
        .map(hotel => {
          const distance = distanceKm(lat, lng, hotel.lat, hotel.lng)
          distanceByHotelId.set(hotel.id, distance)
          return hotel
        })
        .filter(hotel => (distanceByHotelId.get(hotel.id) ?? Infinity) <= radius)
        .sort((a, b) => (distanceByHotelId.get(a.id) ?? Infinity) - (distanceByHotelId.get(b.id) ?? Infinity))
    }

    let filteredHotels = hotels
    if (startDate && endDate && slotType) {
      const now = new Date()
      const roomIds = hotels.flatMap(hotel => hotel.rooms.map(room => room.id))
      const requestedDates = slotType === 'FULLDAY' ? dateRangeStrings(startDate, endDate) : [startDate]
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
      for (const hotel of hotels) {
        const hotelHasAvailability = hotel.rooms.some(room => {
          if (!roomAllowsSlotType(room, slotType)) return false
          const roomSlots = slotsByRoomId.get(room.id) || []
          const roomBookings = bookingsByRoomId.get(room.id) || []
          const startCandidates = roomSlots.filter(candidate => candidate.date === startDate)

          return startCandidates.some(candidate => {
            if (candidate.isBooked || slotIsPastForBooking(candidate.slotType, candidate.date, candidate.startTime, now)) return false
            const hasEveryDate = requestedDates.every(date => roomSlots.some(slot =>
              slot.date === date && slot.startTime === candidate.startTime && slot.endTime === candidate.endTime && !slot.isBooked
            ))
            return hasEveryDate && !roomBookings.some(booking => bookingConflictsWithRequest(booking, {
              dates: requestedDates,
              slotType: candidate.slotType,
              startTime: candidate.startTime,
              endTime: candidate.endTime,
            }))
          })
        })

        if (hotelHasAvailability) {
          availableHotelIds.add(hotel.id)
        }
      }
      filteredHotels = hotels.filter(hotel => availableHotelIds.has(hotel.id))
    }

    if (minRating !== null) {
      filteredHotels = filteredHotels
        .filter(hotel => (ratingByHotelId.get(hotel.id) ?? 0) >= minRating)
        .sort((a, b) => (ratingByHotelId.get(b.id) ?? 0) - (ratingByHotelId.get(a.id) ?? 0))
    }

    const totalCount = filteredHotels.length
    const paginatedHotels = filteredHotels.slice(skip, skip + limit)

    const result = paginatedHotels.map(hotel => {
      const selectedSlotPrice = lowestRoomPrice(hotel.rooms, slotType ?? 'H3')
      const hourlyPrices = hotel.rooms.map(room => room.pricePerHour)

      return {
      selectedSlotPrice: selectedSlotPrice ? selectedSlotPrice * roomCount : null,
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

    return NextResponse.json({ hotels: result, count: totalCount, page })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
