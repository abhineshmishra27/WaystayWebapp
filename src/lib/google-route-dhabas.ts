import 'server-only'

import {
  decodeGoogleEncodedPolyline,
  haversineKm,
  projectStopOntoPolyline,
  type RouteCoordinate,
} from '@/lib/route-search'

const GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'
const GOOGLE_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const ROUTE_RADIUS_KM = 1
const NEARBY_RADIUS_KM = 5
const PAGE_SIZE = 20
const SUPPLEMENTARY_EATERY_QUERIES = ['dhaba', 'fast food restaurant']
const TEXT_SEARCH_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri,places.websiteUri,places.photos,nextPageToken'

export type GoogleRouteDhaba = {
  id: string
  hotelId: null
  name: string
  description: null
  city: null
  state: null
  address: string | null
  image: null
  photoName: string | null
  photoAttributions: Array<{ displayName: string; uri: string | null }>
  rating: number
  reviewCount: number
  startingPrice: null
  tags: string[]
  detourKm: number
  distanceFromStartKm: number
  minutesAhead: number
  mapsUri: string | null
  websiteUri: string | null
  source: 'google'
}

type GoogleRouteResponse = {
  routes?: Array<{
    distanceMeters?: number
    duration?: string
    polyline?: { encodedPolyline?: string }
  }>
}

type GoogleTextSearchResponse = {
  places?: Array<{
    id?: string
    displayName?: { text?: string }
    formattedAddress?: string
    location?: { latitude?: number; longitude?: number }
    rating?: number
    userRatingCount?: number
    priceLevel?: string
    googleMapsUri?: string
    websiteUri?: string
    photos?: Array<{
      name?: string
      authorAttributions?: Array<{
        displayName?: string
        uri?: string
      }>
    }>
  }>
  nextPageToken?: string
}

type GooglePlace = NonNullable<GoogleTextSearchResponse['places']>[number]

type DrivingRoute = {
  encodedPolyline: string
  points: RouteCoordinate[]
  distanceKm: number
  durationMinutes: number | null
}

export class GoogleDhabaSearchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'GoogleDhabaSearchError'
  }
}

export function isGoogleDhabaSearchConfigured() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim())
}

function apiKey() {
  const value = process.env.GOOGLE_MAPS_API_KEY?.trim()
  if (!value) throw new GoogleDhabaSearchError('Google Maps is not configured.')
  return value
}

function googleHeaders(key: string, fieldMask: string) {
  return {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': key,
    'X-Goog-FieldMask': fieldMask,
  }
}

async function googlePost<T>(url: string, body: unknown, fieldMask: string, key: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: googleHeaders(key, fieldMask),
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    throw new GoogleDhabaSearchError('Google Maps could not be reached.')
  }

  if (!response.ok) {
    throw new GoogleDhabaSearchError('Google Maps could not find dhabas for this route.', response.status)
  }

  return response.json() as Promise<T>
}

function coordinate(value: RouteCoordinate) {
  return { latitude: value.latitude, longitude: value.longitude }
}

function durationMinutes(duration: string | undefined) {
  const seconds = Number.parseFloat(duration?.replace(/s$/, '') ?? '')
  return Number.isFinite(seconds) ? seconds / 60 : null
}

function priceTag(priceLevel: string | undefined) {
  const labels: Record<string, string> = {
    PRICE_LEVEL_INEXPENSIVE: 'Budget-friendly',
    PRICE_LEVEL_MODERATE: 'Moderately priced',
    PRICE_LEVEL_EXPENSIVE: 'Premium',
    PRICE_LEVEL_VERY_EXPENSIVE: 'Premium',
  }
  return priceLevel ? labels[priceLevel] ?? null : null
}

async function drivingRoute(origin: RouteCoordinate, destination: RouteCoordinate, key: string): Promise<DrivingRoute> {
  const response = await googlePost<GoogleRouteResponse>(
    GOOGLE_ROUTES_URL,
    {
      origin: { location: { latLng: coordinate(origin) } },
      destination: { location: { latLng: coordinate(destination) } },
      travelMode: 'DRIVE',
    },
    'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration',
    key,
  )
  const route = response.routes?.[0]
  const encodedPolyline = route?.polyline?.encodedPolyline
  if (!route || !encodedPolyline) throw new GoogleDhabaSearchError('Google Maps could not calculate this driving route.')

  const points = decodeGoogleEncodedPolyline(encodedPolyline)
  if (points.length < 2) throw new GoogleDhabaSearchError('Google Maps returned an incomplete driving route.')

  return {
    encodedPolyline,
    points,
    distanceKm: (route.distanceMeters ?? 0) / 1_000,
    durationMinutes: durationMinutes(route.duration),
  }
}

function routeFoodStop(place: GooglePlace, route: DrivingRoute): GoogleRouteDhaba | null {
  const latitude = place.location?.latitude
  const longitude = place.location?.longitude
  if (!place.id || !place.displayName?.text || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  const projection = projectStopOntoPolyline(route.points, { latitude: latitude!, longitude: longitude! })
  if (projection.detourKm > ROUTE_RADIUS_KM) return null

  const estimatedMinutesAhead = route.durationMinutes === null
    ? Math.round((projection.distanceFromStartKm / 65) * 60)
    : Math.round(route.durationMinutes * projection.progress)
  const tags = [priceTag(place.priceLevel)].filter((tag): tag is string => Boolean(tag))
  const photo = place.photos?.[0]
  const photoAttributions = (photo?.authorAttributions ?? []).flatMap(attribution => {
    if (!attribution.displayName) return []
    return [{
      displayName: attribution.displayName,
      uri: attribution.uri ?? null,
    }]
  })

  return {
    id: `google:${place.id}`,
    hotelId: null,
    name: place.displayName.text,
    description: null,
    city: null,
    state: null,
    address: place.formattedAddress ?? null,
    image: null,
    photoName: photo?.name ?? null,
    photoAttributions,
    rating: place.rating ?? 0,
    reviewCount: place.userRatingCount ?? 0,
    startingPrice: null,
    tags,
    detourKm: Number(projection.detourKm.toFixed(1)),
    distanceFromStartKm: Number(projection.distanceFromStartKm.toFixed(1)),
    minutesAhead: Math.max(0, estimatedMinutesAhead),
    mapsUri: place.googleMapsUri ?? null,
    websiteUri: place.websiteUri ?? null,
    source: 'google',
  }
}

function nearbyFoodStop(place: GooglePlace, center: RouteCoordinate): GoogleRouteDhaba | null {
  const latitude = place.location?.latitude
  const longitude = place.location?.longitude
  if (!place.id || !place.displayName?.text || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  const distanceKm = haversineKm(center, { latitude: latitude!, longitude: longitude! })
  if (distanceKm > NEARBY_RADIUS_KM) return null

  const tags = [priceTag(place.priceLevel)].filter((tag): tag is string => Boolean(tag))
  const photo = place.photos?.[0]
  const photoAttributions = (photo?.authorAttributions ?? []).flatMap(attribution => {
    if (!attribution.displayName) return []
    return [{
      displayName: attribution.displayName,
      uri: attribution.uri ?? null,
    }]
  })

  return {
    id: `google:${place.id}`,
    hotelId: null,
    name: place.displayName.text,
    description: null,
    city: null,
    state: null,
    address: place.formattedAddress ?? null,
    image: null,
    photoName: photo?.name ?? null,
    photoAttributions,
    rating: place.rating ?? 0,
    reviewCount: place.userRatingCount ?? 0,
    startingPrice: null,
    tags,
    detourKm: Number(distanceKm.toFixed(1)),
    distanceFromStartKm: Number(distanceKm.toFixed(1)),
    minutesAhead: 0,
    mapsUri: place.googleMapsUri ?? null,
    websiteUri: place.websiteUri ?? null,
    source: 'google',
  }
}

async function searchAlongRoute(
  textQuery: string,
  route: DrivingRoute,
  key: string,
  pageToken?: string,
) {
  return googlePost<GoogleTextSearchResponse>(
    GOOGLE_TEXT_SEARCH_URL,
    {
      textQuery,
      languageCode: 'en',
      regionCode: 'IN',
      pageSize: PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
      searchAlongRouteParameters: {
        polyline: { encodedPolyline: route.encodedPolyline },
      },
    },
    TEXT_SEARCH_FIELD_MASK,
    key,
  )
}

function nearbyLocationRestriction(center: RouteCoordinate) {
  const latitudeDelta = NEARBY_RADIUS_KM / 111.32
  const longitudeDelta = NEARBY_RADIUS_KM / Math.max(0.01, 111.32 * Math.cos(center.latitude * Math.PI / 180))
  return {
    rectangle: {
      low: { latitude: center.latitude - latitudeDelta, longitude: center.longitude - longitudeDelta },
      high: { latitude: center.latitude + latitudeDelta, longitude: center.longitude + longitudeDelta },
    },
  }
}

async function searchNearby(
  textQuery: string,
  center: RouteCoordinate,
  key: string,
  pageToken?: string,
) {
  return googlePost<GoogleTextSearchResponse>(
    GOOGLE_TEXT_SEARCH_URL,
    {
      textQuery,
      languageCode: 'en',
      regionCode: 'IN',
      pageSize: PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
      locationRestriction: nearbyLocationRestriction(center),
    },
    TEXT_SEARCH_FIELD_MASK,
    key,
  )
}

function sortFoodStops(stops: GoogleRouteDhaba[]) {
  // Highest-rated food stops lead; when ratings match, prefer the smaller detour
  // and the stop encountered sooner on the route.
  stops.sort((first, second) => (
    second.rating - first.rating
    || first.detourKm - second.detourKm
    || first.distanceFromStartKm - second.distanceFromStartKm
    || second.reviewCount - first.reviewCount
    || first.name.localeCompare(second.name)
  ))
  return stops
}

/**
 * Finds food stops close to the real driving path. Search Along Route first narrows
 * Google results; the local polyline calculation then strictly removes every result
 * more than one kilometre from that route.
 */
export async function findGoogleDhabasAlongRoute(
  origin: RouteCoordinate,
  destination: RouteCoordinate,
  options: { pageToken?: string } = {},
) {
  const key = apiKey()
  const route = await drivingRoute(origin, destination, key)
  // Separate categorical searches include branded eateries such as McDonald's and
  // Pizza Hut as well as standalone restaurants and dhabas. There is no type or
  // name filter after Google returns candidates.
  const response = await searchAlongRoute('restaurant', route, key, options.pageToken)
  const stopsById = new Map(
    (response.places ?? [])
      .flatMap(place => {
        const stop = routeFoodStop(place, route)
        return stop ? [stop] : []
      })
      .map(stop => [stop.id, stop]),
  )

  // Supplementary categorical queries cover dhabas and branded fast-food outlets
  // that Google's restaurant search may not rank on its first page. The page route
  // reuses this merged live response; it does not trigger this work again when the
  // traveller opens "View all".
  if (!options.pageToken) {
    for (const textQuery of SUPPLEMENTARY_EATERY_QUERIES) {
      const supplementaryResponse = await searchAlongRoute(textQuery, route, key)
      for (const place of supplementaryResponse.places ?? []) {
        const stop = routeFoodStop(place, route)
        if (stop) stopsById.set(stop.id, stop)
      }
    }
  }

  const dhabas = [...stopsById.values()]

  return {
    dhabas: sortFoodStops(dhabas),
    routeDistanceKm: Math.round(route.distanceKm),
    nextPageToken: response.nextPageToken ?? null,
  }
}

/** Finds Google-listed food stops within a strict five-kilometre radius. */
export async function findGoogleDhabasNearby(center: RouteCoordinate, options: { pageToken?: string } = {}) {
  const key = apiKey()
  const response = await searchNearby('restaurant', center, key, options.pageToken)
  const stopsById = new Map(
    (response.places ?? [])
      .flatMap(place => {
        const stop = nearbyFoodStop(place, center)
        return stop ? [stop] : []
      })
      .map(stop => [stop.id, stop]),
  )

  if (!options.pageToken) {
    for (const textQuery of SUPPLEMENTARY_EATERY_QUERIES) {
      const supplementaryResponse = await searchNearby(textQuery, center, key)
      for (const place of supplementaryResponse.places ?? []) {
        const stop = nearbyFoodStop(place, center)
        if (stop) stopsById.set(stop.id, stop)
      }
    }
  }

  return {
    dhabas: sortFoodStops([...stopsById.values()]),
    nextPageToken: response.nextPageToken ?? null,
  }
}
