import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

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
    const slotType = (searchParams.get('slot') as 'H3' | 'H6' | 'H12' | 'FULLDAY' | null)
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
    const limit = 20
    const skip = (page - 1) * limit
    const distanceByHotelId = new Map<string, number>()

    let hotels = await prisma.hotel.findMany({
      where: {
        isApproved: true,
        isActive: true,
        ...(city ? { city: { contains: city, mode: 'insensitive' } } : {}),
      },
      include: {
        images: { orderBy: { sortOrder: 'asc' }, take: 1 },
        reviews: { select: { rating: true } },
        rooms: {
          where: { isActive: true },
          select: { id: true, pricePerHour: true, price_3h: true, price_6h: true, price_12h: true, priceFullDay: true },
          take: 1,
          orderBy: { price_3h: 'asc' },
        },
      },
    })

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
      const availableHotelIds: string[] = []
      for (const hotel of hotels) {
        for (const room of hotel.rooms) {
          const matchingSlots = await prisma.roomSlot.findMany({
            where: {
              roomId: room.id,
              date: { gte: startDate, lte: slotType === 'FULLDAY' ? endDate : startDate },
              slotType,
              isBooked: false,
            },
            select: { date: true },
          })
          const requiredDays = slotType === 'FULLDAY'
            ? Math.floor((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86400000) + 1
            : 1
          if (matchingSlots.length >= requiredDays) {
            availableHotelIds.push(hotel.id)
            break
          }
        }
      }
      filteredHotels = hotels.filter(hotel => availableHotelIds.includes(hotel.id))
    }

    const totalCount = filteredHotels.length
    const paginatedHotels = filteredHotels.slice(skip, skip + limit)

    const result = paginatedHotels.map(hotel => {
      const selectedSlotPrice = slotType === 'H6'
        ? hotel.rooms[0]?.price_6h || null
        : slotType === 'H12'
          ? hotel.rooms[0]?.price_12h || null
          : slotType === 'FULLDAY'
            ? hotel.rooms[0]?.priceFullDay || null
            : hotel.rooms[0]?.price_3h || null

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
      avgRating:
        hotel.reviews.length > 0
          ? hotel.reviews.reduce((sum, review) => sum + review.rating, 0) / hotel.reviews.length
          : 0,
      reviewCount: hotel.reviews.length,
      pricePerHour: hotel.rooms[0]?.pricePerHour || null,
      price3h: hotel.rooms[0]?.price_3h || null,
      price6h: hotel.rooms[0]?.price_6h || null,
      price12h: hotel.rooms[0]?.price_12h || null,
      priceFullDay: hotel.rooms[0]?.priceFullDay || null,
    }
    })

    return NextResponse.json({ hotels: result, count: totalCount, page })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
