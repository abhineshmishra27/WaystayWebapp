import { NextRequest, NextResponse } from 'next/server'
import { GET as searchAvailableHotels } from '@/app/api/search/route'
import { defaultSearchDateForSlot } from '@/lib/booking-time'
import { prisma } from '@/lib/db'
import {
  findGoogleDhabasAlongRoute,
  GoogleDhabaSearchError,
  isGoogleDhabaSearchConfigured,
} from '@/lib/google-route-dhabas'
import { logger } from '@/lib/logger'
import { resolveLocationFromDatabase } from '@/lib/search-db'
import { haversineKm, projectStopOntoRoute, routeCorridorKm } from '@/lib/route-search'

type SlotType = 'H3' | 'FULLDAY'

type SearchHotel = {
  id: string
  name: string
  address: string
  city: string
  state: string
  amenities: string[]
  highwayTag: boolean
  lat: number
  lng: number
  image: string | null
  avgRating: number
  reviewCount: number
  selectedSlotPrice: number | null
  price3h: number | null
  priceFullDay: number | null
  relevanceScore: number
  distanceKm: number | null
  availableStayType?: 'H3' | 'FULLDAY'
}

type SearchResponse = {
  hotels?: SearchHotel[]
  error?: string
}

type RouteEndpoint = {
  id: string
  name: string
  state: string | null
  latitude: number
  longitude: number
}

type RouteDhaba = {
  id: string
  hotelId: string | null
  name: string
  description: string | null
  city: string | null
  state: string | null
  image: string | null
  photoName: string | null
  photoAttributions: Array<{ displayName: string; uri: string | null }>
  rating: number
  reviewCount: number
  startingPrice: number | null
  tags: string[]
  detourKm: number
  distanceFromStartKm: number
  minutesAhead: number
  address: string | null
  mapsUri: string | null
  websiteUri: string | null
  source: 'google' | 'waystay'
}


const ALLOWED_SLOTS = new Set<SlotType>(['H3', 'FULLDAY'])

function addDays(dateValue: string, days: number) {
  const timestamp = Date.parse(`${dateValue}T00:00:00Z`) + (days * 86_400_000)
  return new Date(timestamp).toISOString().slice(0, 10)
}

function validCoordinate(value: number, minimum: number, maximum: number) {
  return Number.isFinite(value) && value >= minimum && value <= maximum
}

async function resolveEndpoint(locationId: string | null, text: string | null): Promise<RouteEndpoint | null> {
  if (locationId) {
    return prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true, state: true, latitude: true, longitude: true },
    })
  }

  if (!text?.trim()) return null
  const resolution = await resolveLocationFromDatabase(text)
  if (!resolution) return null
  return {
    id: resolution.location.id,
    name: resolution.location.name,
    state: resolution.location.state ?? null,
    latitude: resolution.location.latitude,
    longitude: resolution.location.longitude,
  }
}

function highwayName(from: string, to: string) {
  const routeKey = [from, to].map(value => value.toLocaleLowerCase()).join('|')
  const reverseRouteKey = [to, from].map(value => value.toLocaleLowerCase()).join('|')
  const knownRoutes: Record<string, string> = {
    'delhi|jaipur': 'NH 48',
    'bengaluru|mumbai': 'NH 48',
    'mumbai|pune': 'Mumbai–Pune Expressway',
    'delhi|agra': 'Yamuna Expressway',
    'bengaluru|chennai': 'NH 48',
  }
  return knownRoutes[routeKey] ?? knownRoutes[reverseRouteKey] ?? 'Recommended route'
}

function minutesAhead(distanceKm: number) {
  return Math.max(0, Math.round((distanceKm / 65) * 60))
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams
    const dhabaPageToken = params.get('dhabaPageToken')?.trim() || undefined
    if (dhabaPageToken && dhabaPageToken.length > 4_000) {
      return NextResponse.json({ error: 'The next dhaba page is invalid. Search this route again.' }, { status: 400 })
    }
    const requestedSlot = params.get('slot') as SlotType | null
    const slotsToSearch: SlotType[] = requestedSlot && ALLOWED_SLOTS.has(requestedSlot)
      ? [requestedSlot]
      : ['H3', 'FULLDAY']
    const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '')
      ? params.get('date')!
      : defaultSearchDateForSlot('H3')
    const mode = params.get('mode') === 'nearby' ? 'nearby' : 'route'
    const from = mode === 'route'
      ? await resolveEndpoint(params.get('fromLocationId'), params.get('from'))
      : null
    const to = mode === 'route'
      ? await resolveEndpoint(params.get('toLocationId'), params.get('to'))
      : null
    const near = mode === 'nearby'
      ? await resolveEndpoint(params.get('nearLocationId'), params.get('near'))
      : null

    if (mode === 'route' && (!from || !to)) {
      const unresolved = [!from ? params.get('from') : null, !to ? params.get('to') : null]
        .map(value => value?.trim())
        .filter((value): value is string => Boolean(value))
      return NextResponse.json(
        {
          error: unresolved.length > 0
            ? `We could not find ${unresolved.map(value => `"${value}"`).join(' or ')}. Pick a place from the suggestions.`
            : 'Choose a valid starting point and destination.',
        },
        { status: 400 },
      )
    }

    const latitudeParam = params.get('lat')
    const longitudeParam = params.get('lng')
    const latitude = latitudeParam && latitudeParam.trim() ? Number(latitudeParam) : null
    const longitude = longitudeParam && longitudeParam.trim() ? Number(longitudeParam) : null
    const hasNearbyCoordinates = mode === 'nearby'
      && latitude !== null
      && longitude !== null
      && validCoordinate(latitude, -90, 90)
      && validCoordinate(longitude, -180, 180)
    if (mode === 'nearby' && !hasNearbyCoordinates && !near) {
      return NextResponse.json({ error: 'Choose an area to find nearby stops.' }, { status: 400 })
    }

    const availabilityResults = await Promise.all(slotsToSearch.map(async slot => {
      const searchUrl = new URL('/api/search', req.url)
      searchUrl.searchParams.set('slot', slot)
      searchUrl.searchParams.set('startDate', date)
      searchUrl.searchParams.set('endDate', slot === 'FULLDAY' ? addDays(date, 1) : date)
      searchUrl.searchParams.set('roomCount', '1')
      searchUrl.searchParams.set('limit', '100')
      if (mode === 'nearby' && hasNearbyCoordinates) {
        searchUrl.searchParams.set('lat', String(latitude))
        searchUrl.searchParams.set('lng', String(longitude))
        searchUrl.searchParams.set('radius', '50')
      } else if (mode === 'nearby' && near) {
        searchUrl.searchParams.set('city', near.name)
        searchUrl.searchParams.set('locationId', near.id)
      }

      const response = await searchAvailableHotels(new NextRequest(searchUrl))
      const payload = await response.json() as SearchResponse
      return { response, payload, slot }
    }))
    const failedSearch = availabilityResults.find(result => !result.response.ok)
    if (failedSearch) {
      return NextResponse.json(
        { error: failedSearch.payload.error || 'Unable to find available route stops.' },
        { status: failedSearch.response.status },
      )
    }

    const availableHotelById = new Map<string, SearchHotel>()
    for (const availabilityResult of availabilityResults) {
      for (const hotel of availabilityResult.payload.hotels ?? []) {
        if (availableHotelById.has(hotel.id)) continue
        availableHotelById.set(hotel.id, {
          ...hotel,
          availableStayType: availabilityResult.slot === 'FULLDAY' ? 'FULLDAY' : 'H3',
        })
      }
    }
    const availableHotels = [...availableHotelById.values()]
    let appliedCorridorKm = 50
    let expandedSearch = false
    let routeDistanceKm: number | null = null
    let projectedHotels: Array<SearchHotel & {
      detourKm: number
      progress: number
      distanceFromStartKm: number
      minutesAhead: number
    }>

    if (mode === 'route' && from && to) {
      routeDistanceKm = haversineKm(from, to)
      appliedCorridorKm = routeCorridorKm(routeDistanceKm)
      const allProjectedHotels = availableHotels.map(hotel => {
        const projection = projectStopOntoRoute(from, to, {
          latitude: hotel.lat,
          longitude: hotel.lng,
        })
        return {
          ...hotel,
          detourKm: Number(projection.detourKm.toFixed(1)),
          progress: projection.progress,
          distanceFromStartKm: Number(projection.distanceFromStartKm.toFixed(1)),
          minutesAhead: minutesAhead(projection.distanceFromStartKm),
        }
      })

      projectedHotels = allProjectedHotels.filter(hotel => hotel.detourKm <= appliedCorridorKm)
      if (projectedHotels.length === 0 && allProjectedHotels.length > 0) {
        appliedCorridorKm = Math.min(100, appliedCorridorKm * 2)
        projectedHotels = allProjectedHotels.filter(hotel => hotel.detourKm <= appliedCorridorKm)
        expandedSearch = projectedHotels.length > 0
      }
      projectedHotels.sort((first, second) => (
        first.progress - second.progress
        || Number(second.highwayTag) - Number(first.highwayTag)
        || first.detourKm - second.detourKm
        || second.relevanceScore - first.relevanceScore
      ))
    } else {
      projectedHotels = availableHotels.map(hotel => ({
        ...hotel,
        detourKm: hotel.distanceKm ?? 0,
        progress: 0,
        distanceFromStartKm: hotel.distanceKm ?? 0,
        minutesAhead: minutesAhead(hotel.distanceKm ?? 0),
      }))
    }

    const stays = projectedHotels.slice(0, 12)
    const restaurants = stays.length > 0
      ? await prisma.restaurant.findMany({
          where: {
            hotelId: { in: stays.map(stay => stay.id) },
            isActive: true,
            menuItems: { some: { isAvailable: true } },
          },
          select: {
            id: true,
            hotelId: true,
            name: true,
            description: true,
            hotel: { select: { amenities: true } },
            menuItems: {
              where: { isAvailable: true },
              select: { name: true, price: true, isVeg: true, imageUrl: true },
              orderBy: { price: 'asc' },
              take: 6,
            },
          },
        })
      : []
    const stayByHotelId = new Map(stays.map(stay => [stay.id, stay]))
    const routeOrderByHotelId = new Map(stays.map((stay, index) => [stay.id, index]))
    const waystayDhabas: RouteDhaba[] = restaurants.flatMap(restaurant => {
      const stay = stayByHotelId.get(restaurant.hotelId)
      if (!stay) return []
      const startingPrice = restaurant.menuItems[0]?.price ?? null
      const foodImage = restaurant.menuItems.find(item => item.imageUrl)?.imageUrl ?? null
      const tags = [
        restaurant.menuItems.some(item => item.isVeg) ? 'Veg options' : null,
        restaurant.hotel.amenities.some(amenity => amenity.toLocaleLowerCase().includes('parking')) ? 'Parking' : null,
        'Clean stop',
      ].filter((tag): tag is string => Boolean(tag)).slice(0, 2)

      return [{
        id: restaurant.id,
        hotelId: restaurant.hotelId,
        name: restaurant.name,
        description: restaurant.description,
        city: stay.city,
        state: stay.state,
        image: foodImage,
        photoName: null,
        photoAttributions: [],
        rating: stay.avgRating,
        reviewCount: stay.reviewCount,
        startingPrice,
        tags,
        detourKm: stay.detourKm,
        distanceFromStartKm: stay.distanceFromStartKm,
        minutesAhead: stay.minutesAhead,
        address: null,
        mapsUri: null,
        websiteUri: null,
        source: 'waystay' as const,
      }]
    }).sort((first, second) => (
      (routeOrderByHotelId.get(first.hotelId) ?? Number.MAX_SAFE_INTEGER)
      - (routeOrderByHotelId.get(second.hotelId) ?? Number.MAX_SAFE_INTEGER)
    ))

    let dhabas = waystayDhabas
    let dhabaProvider: 'google' | 'waystay' = 'waystay'
    let dhabaNotice: string | null = null
    let dhabaPagination: { nextPageToken: string | null } | undefined
    let googleRouteDistanceKm: number | null = null
    if (mode === 'route' && from && to) {
      if (!isGoogleDhabaSearchConfigured()) {
        dhabaNotice = 'Google Maps is not connected yet. Showing Waystay-listed restaurants while it is set up.'
      } else {
        try {
          const googleResults = await findGoogleDhabasAlongRoute(from, to, { pageToken: dhabaPageToken })
          dhabas = googleResults.dhabas
          dhabaProvider = 'google'
          googleRouteDistanceKm = googleResults.routeDistanceKm
          dhabaPagination = { nextPageToken: googleResults.nextPageToken }
          if (googleResults.nextPageToken) {
            dhabaNotice = 'More food stops are available to load for this route.'
          }
        } catch (error) {
          logger.warn('api.route_stops.google_dhabas_failed', error, {
            mode,
            fromLocationId: from.id,
            toLocationId: to.id,
            status: error instanceof GoogleDhabaSearchError ? error.status : undefined,
          })
          if (dhabaPageToken) {
            return NextResponse.json({ error: 'Unable to load more food stops. Please try again.' }, { status: 502 })
          }
          dhabaNotice = 'Google Maps could not load route dhabas right now. Showing Waystay-listed restaurants instead.'
        }
      }
    }

    return NextResponse.json({
      mode,
      date,
      slot: slotsToSearch.length === 1 ? slotsToSearch[0] : 'ANY',
      route: mode === 'route' && from && to ? {
        from,
        to,
        highway: highwayName(from.name, to.name),
        distanceKm: googleRouteDistanceKm ?? Math.round(routeDistanceKm || 0),
        corridorKm: appliedCorridorKm,
        expanded: expandedSearch,
      } : null,
      stays,
      dhabas,
      dhabaProvider,
      dhabaNotice,
      dhabaPagination,
    })
  } catch (error) {
    logger.error('api.route_stops.failed', error)
    return NextResponse.json({ error: 'Unable to load route stops.' }, { status: 500 })
  }
}
