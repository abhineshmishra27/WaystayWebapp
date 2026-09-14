import './hotels.css'
import { Suspense } from 'react'
import HotelListings from '@/components/hotels/HotelListings'
import HotelListingsSkeleton from '@/components/hotels/HotelListingsSkeleton'
import SearchBar from '@/components/hotels/SearchBar'

type SearchParams = Record<string, string | string[] | undefined>

function normalizeSearchParams(searchParams: SearchParams) {
  return Object.fromEntries(
    Object.entries(searchParams)
      .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
      .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
  )
}

export default async function HotelsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const normalizedSearchParams = normalizeSearchParams(await searchParams)

  return (
    <div className="ws-listing min-h-screen">
      <div className="relative">
        <div aria-hidden className="ws-listing-banner" />
        <div className="ws-listing-width relative pb-7 pt-8">
          <p className="ws-listing-eyebrow">Verified hourly and full-day stays</p>
          <h1 className="ws-listing-title">Find a clean stop for the road ahead</h1>
          <SearchBar
            className="max-w-3xl"
            initialCity={normalizedSearchParams.city}
            initialStartDate={normalizedSearchParams.startDate}
            initialEndDate={normalizedSearchParams.endDate}
            initialSlot={normalizedSearchParams.slot}
            initialGuestCount={normalizedSearchParams.guestCount}
            initialRoomCount={normalizedSearchParams.roomCount}
            initialLat={normalizedSearchParams.lat}
            initialLng={normalizedSearchParams.lng}
            initialRadius={normalizedSearchParams.radius}
            initialLocationId={normalizedSearchParams.locationId}
            initialPlaceId={normalizedSearchParams.placeId}
          />
        </div>
      </div>
      <div className="ws-listing-width py-8">
        <Suspense fallback={<HotelListingsSkeleton />}>
          <HotelListings searchParams={normalizedSearchParams} />
        </Suspense>
      </div>
    </div>
  )
}
