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
      <span className="text-gray-500 text-xs">{rating.toFixed(1)}</span>
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
        <h3 className="text-xl font-semibold text-gray-800 mb-2">No hotels found</h3>
        <p className="text-gray-500 mb-6">
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
              className="bg-[var(--waystay-orange)] text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-[var(--waystay-orange-dark)]"
            >
              Search tomorrow
            </Link>
          )}
          <Link href="/" className="bg-indigo-600 text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-indigo-700">Back to home</Link>
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
      <p className="text-sm text-gray-500 mb-6">
        {resultCount} {isNearMeSearch ? 'nearby ' : ''}hotel{resultCount !== 1 ? 's' : ''} found
        {isNearMeSearch ? ` within ${radiusLabel} km` : resolvedLabel ? ` near ${resolvedLabel}` : searchParams.city ? ` in ${searchParams.city}` : ''}
        {resolvedLocation && resolvedLocation.matchedBy !== 'CANONICAL' && searchParams.city && (
          <span className="ml-2 text-xs text-indigo-600">Showing results for {resolvedLabel}</span>
        )}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {hotels.map((hotel) => (
          <Link
            key={hotel.id}
            href={`/hotels/${hotel.id}${hotelLinkQuery ? `?${hotelLinkQuery}` : ''}`}
            className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:shadow-md transition-shadow"
          >
            <div className="relative aspect-[16/10] bg-gray-100 overflow-hidden">
              {hotel.image
                ? <Image src={hotel.image} alt={hotel.name} fill style={{ objectFit: 'cover' }} />
                : <div className="w-full h-full flex items-center justify-center text-gray-300 text-4xl">🏨</div>
              }
            </div>
            <div className="p-4">
              <h3 className="font-semibold text-gray-900 mb-1 truncate">{hotel.name}</h3>
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
                <span>{hotel.city}, {hotel.state}</span>
                {typeof hotel.distanceKm === 'number' && hotel.relevanceReasons.length === 0 && (
                  <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-[var(--waystay-orange-dark)]">
                    {formatDistance(hotel.distanceKm)}
                  </span>
                )}
              </div>
              {hotel.avgRating > 0 && <StarRating rating={hotel.avgRating} />}
              {hotel.relevanceReasons.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Why this hotel is relevant">
                  {hotel.relevanceReasons.slice(0, 3).map(reason => (
                    <span
                      key={reason}
                      className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-4 rounded-xl border border-[var(--waystay-orange-tint)] bg-[var(--waystay-orange-soft)] px-3 py-2">
                {hotel.selectedSlotPrice ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-lg font-bold text-[var(--waystay-orange-dark)]">₹{hotel.selectedSlotPrice}</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-[var(--waystay-blue)]">{slotLabel}</span>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-gray-500">Price available after selecting dates</p>
                )}
                {!isDayRental && hotel.priceFullDay && (
                  <p className="mt-1 text-xs text-gray-500">Full day from ₹{hotel.priceFullDay}</p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
