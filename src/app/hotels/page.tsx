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
    <div className="min-h-screen bg-[var(--background)]">
      <div className="bg-[var(--waystay-blue)] border-b border-[var(--waystay-blue-light)] px-4 py-6">
        <div className="max-w-6xl mx-auto">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--waystay-orange)]">
            Verified hourly and full-day stays
          </p>
          <h1 className="mb-4 text-2xl font-bold text-white">Find a clean stop for the road ahead</h1>
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
          />
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Suspense fallback={<HotelListingsSkeleton />}>
          <HotelListings searchParams={normalizedSearchParams} />
        </Suspense>
      </div>
    </div>
  )
}
