import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  normalizeLocationQuery,
  type LocationResolution,
} from '@/lib/location-search'

const MINIMUM_LOCATION_CONFIDENCE = 0.4
const MINIMUM_HOTEL_CONFIDENCE = 0.38

type LocationMatchRow = {
  locationId: string
  matchedText: string
  matchedBy: 'CANONICAL' | 'ALIAS' | 'FUZZY'
  matchTier: number
  confidence: number
}

export type DatabaseLocationResolution = LocationResolution & {
  matchTier: number
}

export type HotelTextMatch = {
  hotelId: string
  matchTier: number
  confidence: number
}

export type NearbyHotelMatch = {
  hotelId: string
  distanceKm: number
}

export type PlaceSuggestion = {
  id: string
  kind: 'LOCATION' | 'HOTEL' | 'LANDMARK'
  name: string
  label: string
  city: string | null
  state: string | null
  locationId: string | null
  placeId: string | null
  matchedText: string
  confidence: number
}

type LocationSuggestionRow = {
  id: string
  name: string
  type: 'CITY' | 'LOCALITY' | 'LANDMARK' | 'AIRPORT'
  state: string | null
  parentName: string | null
  matchedText: string
  confidence: number
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export async function findNearbyHotels(
  latitude: number,
  longitude: number,
  radiusKm: number,
  limit = 2000,
): Promise<NearbyHotelMatch[]> {
  const safeRadiusKm = clamp(radiusKm, 1, 250)
  const safeLimit = Math.max(1, Math.min(5000, Math.floor(limit)))

  const rows = await prisma.$queryRaw<Array<{ hotelId: string; distanceKm: number }>>(Prisma.sql`
    WITH search_origin AS (
      SELECT public.ST_SetSRID(public.ST_MakePoint(${longitude}, ${latitude}), 4326)::public.geography AS point
    )
    SELECT
      hotel."id" AS "hotelId",
      (public.ST_Distance(hotel."geoPoint", origin.point) / 1000.0)::DOUBLE PRECISION AS "distanceKm"
    FROM "Hotel" hotel
    CROSS JOIN search_origin origin
    WHERE hotel."isApproved" = TRUE
      AND hotel."isActive" = TRUE
      AND hotel."ownerEnabled" = TRUE
      AND public.ST_DWithin(hotel."geoPoint", origin.point, ${safeRadiusKm * 1000})
    ORDER BY public.ST_Distance(hotel."geoPoint", origin.point)
    LIMIT ${safeLimit}
  `)

  return rows.map(row => ({ hotelId: row.hotelId, distanceKm: Number(row.distanceKm) }))
}

export async function findHotelBookingPopularity(hotelIds: string[]) {
  if (hotelIds.length === 0) return new Map<string, number>()

  const rows = await prisma.$queryRaw<Array<{ hotelId: string; bookingCount: number }>>(Prisma.sql`
    SELECT
      room."hotelId" AS "hotelId",
      COALESCE(SUM(booking."roomCount"), 0)::INTEGER AS "bookingCount"
    FROM "Booking" booking
    INNER JOIN "RoomSlot" room_slot ON room_slot."id" = booking."roomSlotId"
    INNER JOIN "Room" room ON room."id" = room_slot."roomId"
    WHERE room."hotelId" IN (${Prisma.join(hotelIds)})
      AND booking."status" IN ('CONFIRMED', 'COMPLETED')
    GROUP BY room."hotelId"
  `)

  return new Map(rows.map(row => [row.hotelId, Number(row.bookingCount)]))
}

export async function resolveLocationFromDatabase(input: string): Promise<DatabaseLocationResolution | null> {
  const query = normalizeLocationQuery(input)
  if (!query) return null

  const rows = await prisma.$queryRaw<LocationMatchRow[]>(Prisma.sql`
    WITH candidates AS (
      SELECT
        location."id" AS "locationId",
        location."name" AS "matchedText",
        CASE
          WHEN location."normalizedName" = ${query} THEN 'CANONICAL'
          ELSE 'FUZZY'
        END AS "matchedBy",
        CASE
          WHEN location."normalizedName" = ${query} THEN 2
          WHEN location."normalizedName" LIKE ${`${query}%`} THEN 4
          ELSE 5
        END::INTEGER AS "matchTier",
        CASE
          WHEN location."normalizedName" = ${query} THEN 1::REAL
          WHEN location."normalizedName" LIKE ${`${query}%`} THEN 0.9::REAL
          ELSE public.similarity(location."normalizedName", ${query})
        END AS confidence
      FROM "Location" location
      WHERE
        location."normalizedName" = ${query}
        OR location."normalizedName" LIKE ${`${query}%`}
        OR location."normalizedName" % ${query}

      UNION ALL

      SELECT
        alias."locationId",
        alias."alias" AS "matchedText",
        CASE
          WHEN alias."normalizedAlias" = ${query} THEN 'ALIAS'
          ELSE 'FUZZY'
        END AS "matchedBy",
        CASE
          WHEN alias."normalizedAlias" = ${query} THEN 3
          WHEN alias."normalizedAlias" LIKE ${`${query}%`} THEN 4
          ELSE 5
        END::INTEGER AS "matchTier",
        CASE
          WHEN alias."normalizedAlias" = ${query} THEN 1::REAL
          WHEN alias."normalizedAlias" LIKE ${`${query}%`} THEN 0.9::REAL
          ELSE public.similarity(alias."normalizedAlias", ${query})
        END AS confidence
      FROM "LocationAlias" alias
      WHERE
        alias."normalizedAlias" = ${query}
        OR alias."normalizedAlias" LIKE ${`${query}%`}
        OR alias."normalizedAlias" % ${query}
    )
    SELECT "locationId", "matchedText", "matchedBy", "matchTier", confidence
    FROM candidates
    WHERE "matchTier" < 5 OR confidence >= ${MINIMUM_LOCATION_CONFIDENCE}
    ORDER BY "matchTier" ASC, confidence DESC, "matchedText" ASC
    LIMIT 1
  `)

  const match = rows[0]
  if (!match) return null

  const location = await prisma.location.findUnique({
    where: { id: match.locationId },
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
  if (!location) return null

  return {
    location,
    matchedText: match.matchedText,
    matchedBy: match.matchedBy,
    matchTier: match.matchTier,
    score: Number(match.confidence),
  }
}

export async function findHotelTextMatches(input: string, limit = 100): Promise<HotelTextMatch[]> {
  const query = normalizeLocationQuery(input)
  if (!query) return []

  return prisma.$queryRaw<HotelTextMatch[]>(Prisma.sql`
    WITH searchable_hotels AS (
      SELECT
        hotel."id" AS "hotelId",
        public.waystay_normalize(hotel."name") AS normalized_name,
        public.waystay_normalize(hotel."address") AS normalized_address,
        public.waystay_normalize(hotel."city") AS normalized_city,
        public.waystay_normalize(hotel."state") AS normalized_state,
        public.waystay_normalize(hotel."pincode") AS normalized_pincode,
        public.waystay_hotel_search_vector(
          hotel."name",
          hotel."address",
          hotel."city",
          hotel."state",
          hotel."pincode"
        ) AS search_vector
      FROM "Hotel" hotel
      WHERE hotel."isApproved" = TRUE
        AND hotel."isActive" = TRUE
        AND hotel."ownerEnabled" = TRUE
    ),
    scored AS (
      SELECT
        searchable."hotelId",
        CASE
          WHEN searchable.normalized_name = ${query} THEN 1
          WHEN searchable.normalized_name LIKE ${`${query}%`}
            OR searchable.normalized_name LIKE ${`% ${query}%`} THEN 4
          ELSE 6
        END::INTEGER AS "matchTier",
        CASE
          WHEN searchable.normalized_name = ${query} THEN 1::REAL
          WHEN searchable.normalized_name LIKE ${`${query}%`}
            OR searchable.normalized_name LIKE ${`% ${query}%`} THEN 0.9::REAL
          ELSE GREATEST(
            public.similarity(searchable.normalized_name, ${query}),
            public.word_similarity(${query}, searchable.normalized_name),
            public.word_similarity(${query}, searchable.normalized_address),
            public.similarity(searchable.normalized_city, ${query}),
            public.similarity(searchable.normalized_state, ${query}),
            CASE WHEN searchable.normalized_pincode = ${query} THEN 1::REAL ELSE 0::REAL END,
            LEAST(
              1::REAL,
              ts_rank_cd(
                searchable.search_vector,
                websearch_to_tsquery('simple', public.waystay_unaccent(${query}))
              ) * 4
            )
          )
        END AS confidence
      FROM searchable_hotels searchable
      WHERE
        searchable.normalized_name = ${query}
        OR searchable.normalized_name LIKE ${`${query}%`}
        OR searchable.normalized_name LIKE ${`% ${query}%`}
        OR searchable.normalized_name % ${query}
        OR searchable.normalized_address LIKE ${`%${query}%`}
        OR searchable.normalized_city LIKE ${`${query}%`}
        OR searchable.normalized_address % ${query}
        OR searchable.normalized_city % ${query}
        OR searchable.normalized_state % ${query}
        OR searchable.normalized_pincode = ${query}
        OR searchable.search_vector @@ websearch_to_tsquery('simple', public.waystay_unaccent(${query}))
    )
    SELECT "hotelId", "matchTier", confidence
    FROM scored
    WHERE "matchTier" < 6 OR confidence >= ${MINIMUM_HOTEL_CONFIDENCE}
    ORDER BY "matchTier" ASC, confidence DESC, "hotelId" ASC
    LIMIT ${Math.max(1, Math.min(500, limit))}
  `)
}

export async function suggestSearchPlaces(input: string, perGroupLimit = 5) {
  const query = normalizeLocationQuery(input)
  if (query.length < 2) {
    return { locations: [] as PlaceSuggestion[], hotels: [] as PlaceSuggestion[], landmarks: [] as PlaceSuggestion[] }
  }

  const safeLimit = Math.max(1, Math.min(10, perGroupLimit))
  const [locationRows, hotelMatches] = await Promise.all([
    prisma.$queryRaw<LocationSuggestionRow[]>(Prisma.sql`
      WITH candidates AS (
        SELECT
          location."id",
          location."name" AS "matchedText",
          CASE
            WHEN location."normalizedName" = ${query} THEN 2
            WHEN location."normalizedName" LIKE ${`${query}%`} THEN 4
            ELSE 5
          END::INTEGER AS match_tier,
          CASE
            WHEN location."normalizedName" = ${query} THEN 1::REAL
            WHEN location."normalizedName" LIKE ${`${query}%`} THEN 0.9::REAL
            ELSE public.similarity(location."normalizedName", ${query})
          END AS confidence
        FROM "Location" location
        WHERE
          location."normalizedName" = ${query}
          OR location."normalizedName" LIKE ${`${query}%`}
          OR location."normalizedName" % ${query}

        UNION ALL

        SELECT
          alias."locationId" AS "id",
          alias."alias" AS "matchedText",
          CASE
            WHEN alias."normalizedAlias" = ${query} THEN 3
            WHEN alias."normalizedAlias" LIKE ${`${query}%`} THEN 4
            ELSE 5
          END::INTEGER AS match_tier,
          CASE
            WHEN alias."normalizedAlias" = ${query} THEN 1::REAL
            WHEN alias."normalizedAlias" LIKE ${`${query}%`} THEN 0.9::REAL
            ELSE public.similarity(alias."normalizedAlias", ${query})
          END AS confidence
        FROM "LocationAlias" alias
        WHERE
          alias."normalizedAlias" = ${query}
          OR alias."normalizedAlias" LIKE ${`${query}%`}
          OR alias."normalizedAlias" % ${query}
      ),
      best_candidates AS (
        SELECT DISTINCT ON (candidate."id")
          candidate."id",
          candidate."matchedText",
          candidate.match_tier,
          candidate.confidence
        FROM candidates candidate
        WHERE candidate.match_tier < 5 OR candidate.confidence >= ${MINIMUM_LOCATION_CONFIDENCE}
        ORDER BY candidate."id", candidate.match_tier ASC, candidate.confidence DESC
      )
      SELECT
        location."id",
        location."name",
        location."type",
        location."state",
        parent."name" AS "parentName",
        candidate."matchedText",
        candidate.confidence
      FROM best_candidates candidate
      JOIN "Location" location ON location."id" = candidate."id"
      LEFT JOIN "Location" parent ON parent."id" = location."parentLocationId"
      ORDER BY candidate.match_tier ASC, candidate.confidence DESC, location."name" ASC
      LIMIT ${safeLimit * 2}
    `),
    findHotelTextMatches(query, safeLimit),
  ])

  const matchedLocationIds = locationRows
    .filter(row => row.type !== 'LANDMARK')
    .map(row => row.id)
  const [relatedLandmarks, locationHotels] = await Promise.all([
    matchedLocationIds.length > 0
      ? prisma.location.findMany({
          where: { type: 'LANDMARK', parentLocationId: { in: matchedLocationIds } },
          select: {
            id: true,
            name: true,
            type: true,
            state: true,
            parentLocation: { select: { name: true } },
          },
          take: safeLimit,
        })
      : [],
    matchedLocationIds.length > 0
      ? prisma.hotel.findMany({
          where: {
            locationId: { in: matchedLocationIds },
            isApproved: true,
            isActive: true,
            ownerEnabled: true,
          },
          select: { id: true, name: true, city: true, state: true },
          take: safeLimit,
        })
      : [],
  ])
  const directLandmarkIds = new Set(locationRows.filter(row => row.type === 'LANDMARK').map(row => row.id))
  const combinedLocationRows: LocationSuggestionRow[] = [
    ...locationRows,
    ...relatedLandmarks
      .filter(landmark => !directLandmarkIds.has(landmark.id))
      .map(landmark => ({
        id: landmark.id,
        name: landmark.name,
        type: landmark.type,
        state: landmark.state,
        parentName: landmark.parentLocation?.name ?? null,
        matchedText: landmark.parentLocation?.name ?? landmark.name,
        confidence: 0.85,
      })),
  ]

  const hotelIds = [...new Set([...hotelMatches.map(match => match.hotelId), ...locationHotels.map(hotel => hotel.id)])]
  const hotels = hotelIds.length > 0
    ? await prisma.hotel.findMany({
        where: { id: { in: hotelIds } },
        select: { id: true, name: true, city: true, state: true },
      })
    : []
  const hotelById = new Map(hotels.map(hotel => [hotel.id, hotel]))

  const toLocationSuggestion = (row: LocationSuggestionRow): PlaceSuggestion => ({
    id: row.id,
    kind: row.type === 'LANDMARK' ? 'LANDMARK' : 'LOCATION',
    name: row.name,
    label: row.parentName ? `${row.name}, ${row.parentName}` : row.name,
    city: row.type === 'CITY' ? row.name : row.parentName,
    state: row.state,
    locationId: row.id,
    placeId: null,
    matchedText: row.matchedText,
    confidence: Number(row.confidence),
  })

  const hotelMatchById = new Map(hotelMatches.map(match => [match.hotelId, match]))
  const locationHotelIds = new Set(locationHotels.map(hotel => hotel.id))
  const locationSuggestions = combinedLocationRows.map(toLocationSuggestion)
  const hotelSuggestions = hotelIds.flatMap<PlaceSuggestion>(hotelId => {
    const match = hotelMatchById.get(hotelId)
    const hotel = hotelById.get(hotelId)
    return hotel
      ? [{
          id: hotel.id,
          kind: 'HOTEL',
          name: hotel.name,
          label: hotel.name,
          city: hotel.city,
          state: hotel.state,
          locationId: null,
          placeId: hotel.id,
          matchedText: hotel.name,
          confidence: Number(match?.confidence ?? (locationHotelIds.has(hotelId) ? 0.85 : 0)),
        }]
      : []
  })

  return {
    locations: locationSuggestions.filter(suggestion => suggestion.kind === 'LOCATION').slice(0, safeLimit),
    hotels: hotelSuggestions.slice(0, safeLimit),
    landmarks: locationSuggestions.filter(suggestion => suggestion.kind === 'LANDMARK').slice(0, safeLimit),
  }
}
