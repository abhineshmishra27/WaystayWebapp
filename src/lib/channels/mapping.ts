/**
 * Pure translation between a channel manager's nightly world and WayStay's hourly one.
 *
 * No I/O and no Prisma imports - everything here is a function of its arguments so it
 * can be tested against captured fixtures without a network or a database.
 */

import { PLATFORM_CURRENCY } from '@/lib/money'
import type { ExternalAvailability, ExternalProperty, ExternalRoomType } from '@/lib/channels/types'

/** WayStay operates on IST date strings; see todayInIndia() in src/lib/booking-time.ts. */
export const SUPPORTED_TIMEZONE = 'Asia/Kolkata'
/**
 * Re-exported from the platform constant rather than restated. The currency a property
 * must quote in and the currency bookings are charged in are the same fact, and an
 * importer that disagreed with the payment path would admit properties that could
 * never be billed correctly.
 */
export const SUPPORTED_CURRENCY = PLATFORM_CURRENCY

export type ImportRejection = {
  reason: string
  detail: string
}

export type HotelImportFields = {
  name: string
  description: string
  address: string
  city: string
  state: string
  country: string
  pincode: string
  lat: number
  lng: number
  checkInTime: string
  checkOutTime: string
  amenities: string[]
  rating_avg: number
  total_review: number
}

export type RoomImportFields = {
  name: string
  description: string
  type: 'STANDARD' | 'DELUXE' | 'SUITE'
  inventoryCount: number
  maxOccupancy: number
  amenities: string[]
  images: string[]
  pricePerHour: number
  price_3h: number
  price_6h: number
  price_9h: number
  price_12h: number
  priceFullDay: number
  threeHourEnabled: boolean
  sixHourEnabled: boolean
  twelveHourEnabled: boolean
  nightStayEnabled: boolean
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

function normalizeTime(value: string | null | undefined, fallback: string) {
  if (!value) return fallback
  const trimmed = value.trim()
  if (TIME_PATTERN.test(trimmed)) return trimmed
  // Providers commonly send "14:00:00" or "2:00 PM"; accept the former, fall back on the rest.
  const withSeconds = /^([01]?\d|2[0-3]):([0-5]\d):[0-5]\d$/.exec(trimmed)
  if (withSeconds) return `${withSeconds[1].padStart(2, '0')}:${withSeconds[2]}`
  return fallback
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * A property must be usable before we create anything from it. Rejecting loudly here
 * beats importing a hotel that silently never appears in search, or one priced in the
 * wrong currency.
 */
export function validatePropertyForImport(property: ExternalProperty): ImportRejection[] {
  const rejections: ImportRejection[] = []

  if (!collapseWhitespace(property.name ?? '')) {
    rejections.push({ reason: 'MISSING_NAME', detail: 'Property has no name' })
  }

  if (property.currency?.toUpperCase() !== SUPPORTED_CURRENCY) {
    rejections.push({
      reason: 'UNSUPPORTED_CURRENCY',
      detail:
        `Property is priced in ${property.currency || 'an unknown currency'}. WayStay settles in ` +
        `${SUPPORTED_CURRENCY} and does not convert rates, so importing it would misprice every stay.`,
    })
  }

  if (property.timezone !== SUPPORTED_TIMEZONE) {
    rejections.push({
      reason: 'UNSUPPORTED_TIMEZONE',
      detail:
        `Property runs on ${property.timezone || 'an unknown timezone'}. Availability dates would be ` +
        `off by a day against WayStay's ${SUPPORTED_TIMEZONE} calendar.`,
    })
  }

  if (!isUsableCoordinate(property.latitude, property.longitude)) {
    rejections.push({
      reason: 'MISSING_COORDINATES',
      detail: 'Property has no usable latitude/longitude, so it could never appear in radius search',
    })
  }

  return rejections
}

export function isUsableCoordinate(latitude: number | null, longitude: number | null): boolean {
  if (latitude === null || longitude === null) return false
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false
  // 0,0 is in the Atlantic and is the classic "provider sent us nothing" value.
  return !(latitude === 0 && longitude === 0)
}

export function toHotelFields(property: ExternalProperty): HotelImportFields {
  const name = collapseWhitespace(property.name)
  return {
    name,
    description: collapseWhitespace(property.description ?? '') || `${name}, imported from a partner channel.`,
    address: collapseWhitespace(property.address ?? '') || name,
    city: collapseWhitespace(property.city ?? ''),
    state: collapseWhitespace(property.state ?? ''),
    country: collapseWhitespace(property.country ?? '') || 'India',
    pincode: collapseWhitespace(property.postalCode ?? ''),
    lat: property.latitude as number,
    lng: property.longitude as number,
    checkInTime: normalizeTime(property.checkInTime, '12:00'),
    checkOutTime: normalizeTime(property.checkOutTime, '11:00'),
    amenities: dedupeAmenities(property.amenities),
    // Imported hotels start unrated. Inheriting an OTA's rating would misrepresent
    // WayStay's own review data, which is what search ranking is built on.
    rating_avg: 0,
    total_review: 0,
  }
}

function dedupeAmenities(amenities: string[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const amenity of amenities ?? []) {
    const clean = collapseWhitespace(amenity)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(clean)
  }
  return result
}

/**
 * Channel inventory is nightly only. Hourly tiers are switched off rather than
 * guessed at - a fabricated 3-hour price on someone else's room would be sold at a
 * rate the property never agreed to.
 */
export function toRoomFields(roomType: ExternalRoomType): RoomImportFields {
  const name = collapseWhitespace(roomType.name) || 'Room'
  const nightlyRate = roundRate(roomType.nightlyRate)

  return {
    name,
    description: collapseWhitespace(roomType.description ?? '') || `${name} at a partner-managed property.`,
    type: 'STANDARD',
    inventoryCount: Math.max(1, Math.floor(roomType.unitCount || 1)),
    maxOccupancy: Math.max(1, Math.floor(roomType.maxOccupancy || 1)),
    amenities: dedupeAmenities(roomType.amenities),
    images: (roomType.imageUrls ?? []).filter(url => typeof url === 'string' && url.length > 0),
    pricePerHour: 0,
    price_3h: 0,
    price_6h: 0,
    price_9h: 0,
    price_12h: 0,
    priceFullDay: nightlyRate,
    threeHourEnabled: false,
    sixHourEnabled: false,
    twelveHourEnabled: false,
    nightStayEnabled: true,
  }
}

export function roundRate(rate: number) {
  if (!Number.isFinite(rate) || rate < 0) return 0
  return Math.round(rate * 100) / 100
}

export type HoldComputation = {
  externalRoomTypeId: string
  date: string
  unitsHeld: number
}

/**
 * Converts "units still for sale on the channel" into "units WayStay must not sell".
 *
 * A closed date holds the entire room, and a provider reporting more availability than
 * we know about is clamped rather than trusted - over-holding costs a booking, but
 * under-holding sells a room twice.
 */
export function computeHolds(
  availability: ExternalAvailability[],
  unitCountByRoomTypeId: Map<string, number>,
): HoldComputation[] {
  const holds: HoldComputation[] = []

  for (const entry of availability) {
    const inventory = unitCountByRoomTypeId.get(entry.externalRoomTypeId)
    if (inventory === undefined) continue
    if (!isValidDateString(entry.date)) continue

    const totalUnits = Math.max(0, Math.floor(inventory))
    const available = entry.closed
      ? 0
      : Math.min(totalUnits, Math.max(0, Math.floor(entry.unitsAvailable)))

    holds.push({
      externalRoomTypeId: entry.externalRoomTypeId,
      date: entry.date,
      unitsHeld: totalUnits - available,
    })
  }

  return holds
}

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  if (!Number.isFinite(timestamp)) return false
  // Rejects 2026-02-31 and friends, which Date.parse would silently roll over.
  return new Date(timestamp).toISOString().slice(0, 10) === value
}

/** Inclusive list of date strings, used to size availability windows. */
export function dateWindow(startDate: string, days: number) {
  if (!isValidDateString(startDate) || days < 1) return []
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const dates: string[] = []
  for (let offset = 0; offset < days; offset++) {
    dates.push(new Date(start + offset * 86_400_000).toISOString().slice(0, 10))
  }
  return dates
}
