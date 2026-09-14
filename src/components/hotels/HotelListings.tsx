import Image from 'next/image'
import Link from 'next/link'
import { headers } from 'next/headers'
import { todayInIndia } from '@/lib/booking-time'

interface HotelCardType {
  id: string
  name: string
  city: string
  state: string
  image: string | null
  avgRating: number
  reviewCount: number
  pricePerHour: number | null
  selectedSlotPrice: number | null
  price3h: number | null
  price6h: number | null
  price12h: number | null
  priceFullDay: number | null
  distanceKm: number | null
  relevanceScore: number
  bayesianRating: number
  relevanceReasons: string[]
}

interface ResolvedLocation {
  name: string
  type: 'CITY' | 'LOCALITY' | 'LANDMARK' | 'AIRPORT'
  parentName: string | null
  matchedText: string
  matchedBy: 'CANONICAL' | 'ALIAS' | 'FUZZY'
  confidence: number
}

interface SearchRadius {
  initialKm: number
  appliedKm: number
  expanded: boolean
  attemptedExpansion: boolean
  locationName: string
  noResultsWithinInitial: boolean
}

async function fetchHotels(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString()
  const headerStore = await headers()
  const host = headerStore.get('host') || 'localhost:3000'
  const protocol = headerStore.get('x-forwarded-proto') || 'http'
  const baseUrl = `${protocol}://${host}`
  const res = await fetch(`${baseUrl}/api/search?${query}`, { cache: 'no-store' })
  if (!res.ok) return { hotels: [] }

  try {
    return await res.json()
  } catch {
    return { hotels: [] }
  }
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-yellow-400 text-sm">{'★'.repeat(Math.round(rating))}{'☆'.repeat(5 - Math.round(rating))}</span>
      <span className="text-xs text-[var(--muted)]">{rating.toFixed(1)}</span>
    </div>
  )
}

function formatDistance(distanceKm: number) {
  if (distanceKm < 1) return `${Math.max(50, Math.round(distanceKm * 1000))} m away`
  return `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km away`
}

function followingDate(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export default async function HotelListings({ searchParams }: { searchParams: Record<string, string> }) {
  const { hotels, count, resolvedLocation, searchRadius } = await fetchHotels(searchParams) as {
    hotels: HotelCardType[]
    count?: number
    resolvedLocation?: ResolvedLocation | null
    searchRadius?: SearchRadius | null
  }
  const isNearMeSearch = Boolean(searchParams.lat && searchParams.lng)
  const radiusLabel = searchParams.radius || '50'
  const resultCount = typeof count === 'number' ? count : hotels?.length || 0
  const resolvedLabel = resolvedLocation
    ? `${resolvedLocation.name}${resolvedLocation.parentName ? `, ${resolvedLocation.parentName}` : ''}`
    : null
  const isSameDayHourlySearch = Boolean(
    searchParams.startDate === todayInIndia()
    && searchParams.slot
    && searchParams.slot !== 'FULLDAY',
  )
  const tomorrowSearchParams = isSameDayHourlySearch
    ? {
        ...searchParams,
        date: followingDate(searchParams.startDate),
        startDate: followingDate(searchParams.startDate),
        endDate: followingDate(searchParams.startDate),
      }
    : null

  if (!hotels || hotels.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">🔍</div>
        <h3 className="mb-2 text-xl font-bold tracking-[-.5px] text-[var(--ink)]">No hotels found</h3>
        <p className="mb-6 text-[var(--muted)]">
          {isNearMeSearch
            ? `No hotels found within ${radiusLabel} km. Try searching for a city or adjusting your dates.`
            : isSameDayHourlySearch
              ? `No ${searchParams.slot === 'H6' ? '6-hour' : searchParams.slot === 'H12' ? '12-hour' : '3-hour'} slots remain today. Past slots are hidden; try tomorrow or another stay duration.`
            : searchRadius?.attemptedExpansion
              ? `No available hotels found within ${searchRadius.appliedKm} km of ${searchRadius.locationName}, after expanding the search from ${searchRadius.initialKm} km.`
            : resolvedLabel
              ? `We understood this as ${resolvedLabel}, but no available hotels matched your dates.`
              : 'Try searching for a different city or adjust your dates'}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {tomorrowSearchParams && (
            <Link
              href={`/hotels?${new URLSearchParams(tomorrowSearchParams).toString()}`}
              className="rounded-[10px] bg-[var(--orange)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--waystay-orange-dark)]"
            >
              Search tomorrow
            </Link>
          )}
          <Link href="/" className="rounded-[10px] border border-[#e2d9cc] bg-white px-6 py-3 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--orange)]">Back to home</Link>
        </div>
      </div>
    )
  }

  const hotelLinkQuery = new URLSearchParams(searchParams).toString()
  const slotLabel = searchParams.slot === 'H6'
    ? '6-hour slot'
    : searchParams.slot === 'H12'
      ? '12-hour slot'
      : searchParams.slot === 'FULLDAY'
        ? 'Full day'
        : '3-hour slot'
  const isDayRental = searchParams.slot === 'FULLDAY'

  return (
    <div>
      {searchRadius?.expanded && (
        <p role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No hotels within {searchRadius.initialKm} km of {searchRadius.locationName}. Showing hotels within {searchRadius.appliedKm} km.
        </p>
      )}
      <p className="ws-listing-count">
        {resultCount} {isNearMeSearch ? 'nearby ' : ''}hotel{resultCount !== 1 ? 's' : ''} found
        {isNearMeSearch ? ` within ${radiusLabel} km` : resolvedLabel ? ` near ${resolvedLabel}` : searchParams.city ? ` in ${searchParams.city}` : ''}
        {resolvedLocation && resolvedLocation.matchedBy !== 'CANONICAL' && searchParams.city && (
          <span className="ml-2 text-xs font-semibold text-[var(--waystay-orange-dark)]">Showing results for {resolvedLabel}</span>
        )}
      </p>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {hotels.map((hotel) => (
          <Link
            key={hotel.id}
            href={`/hotels/${hotel.id}${hotelLinkQuery ? `?${hotelLinkQuery}` : ''}`}
            className="ws-listing-card"
          >
            <div className="relative aspect-[16/10] overflow-hidden bg-[#eee4d6]">
              {hotel.image
                ? <Image src={hotel.image} alt={hotel.name} fill style={{ objectFit: 'cover' }} />
                : <div className="flex h-full w-full items-center justify-center text-4xl opacity-40">🏨</div>
              }
            </div>
            <div className="p-4">
              <h3 className="mb-1 truncate text-base font-bold tracking-[-.4px] text-[var(--ink)]">{hotel.name}</h3>
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--muted)]">
                <span>{hotel.city}, {hotel.state}</span>
                {typeof hotel.distanceKm === 'number' && hotel.relevanceReasons.length === 0 && (
                  <span className="ws-listing-chip">{formatDistance(hotel.distanceKm)}</span>
                )}
              </div>
              {hotel.avgRating > 0 && <StarRating rating={hotel.avgRating} />}
              {hotel.relevanceReasons.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Why this hotel is relevant">
                  {hotel.relevanceReasons.slice(0, 3).map(reason => (
                    <span key={reason} className="ws-listing-chip">{reason}</span>
                  ))}
                </div>
              )}
              <div className="ws-listing-price mt-4">
                {hotel.selectedSlotPrice ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-bold text-[var(--orange)]">₹{hotel.selectedSlotPrice}</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink)]">{slotLabel}</span>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-[var(--muted)]">Price available after selecting dates</p>
                )}
                {!isDayRental && hotel.priceFullDay && (
                  <p className="mt-1 text-xs text-[var(--muted)]">Full day from ₹{hotel.priceFullDay}</p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
