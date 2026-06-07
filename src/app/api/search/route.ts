import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url, process.env.NEXTAUTH_URL || 'http://localhost:3000')
    const city = searchParams.get('city')
    const lat = parseFloat(searchParams.get('lat') || '0')
    const lng = parseFloat(searchParams.get('lng') || '0')
    const radius = parseFloat(searchParams.get('radius') || '10')
    const date = searchParams.get('date')
    const startDate = searchParams.get('startDate') ?? date
    const endDate = searchParams.get('endDate') ?? startDate
    const slotType = (searchParams.get('slot') as 'H3' | 'H6' | 'H12' | 'FULLDAY' | null)

    if (searchParams.get('lat') && (isNaN(lat) || lat < -90 || lat > 90)) {
      return NextResponse.json({ error: 'Invalid lat' }, { status: 400 })
    }
    if (searchParams.get('lng') && (isNaN(lng) || lng < -180 || lng > 180)) {
      return NextResponse.json({ error: 'Invalid lng' }, { status: 400 })
    }
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = 20
    const skip = (page - 1) * limit

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
          select: { id: true, pricePerHour: true, priceFullDay: true },
          take: 1,
          orderBy: { pricePerHour: 'asc' },
        },
      },
      skip,
      take: limit,
    })

    if (lat && lng && !city) {
      hotels = hotels.filter(hotel => {
        const R = 6371
        const dLat = ((hotel.lat - lat) * Math.PI) / 180
        const dLng = ((hotel.lng - lng) * Math.PI) / 180
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((lat * Math.PI) / 180) *
            Math.cos((hotel.lat * Math.PI) / 180) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        const distance = R * c
        return distance <= radius
      })
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

    const result = filteredHotels.map(hotel => ({
      id: hotel.id,
      name: hotel.name,
      city: hotel.city,
      state: hotel.state,
      lat: hotel.lat,
      lng: hotel.lng,
      image: hotel.images[0]?.url || null,
      avgRating:
        hotel.reviews.length > 0
          ? hotel.reviews.reduce((sum, review) => sum + review.rating, 0) / hotel.reviews.length
          : 0,
      reviewCount: hotel.reviews.length,
      pricePerHour: hotel.rooms[0]?.pricePerHour || null,
      priceFullDay: hotel.rooms[0]?.priceFullDay || null,
    }))

    return NextResponse.json({ hotels: result, count: result.length, page })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
