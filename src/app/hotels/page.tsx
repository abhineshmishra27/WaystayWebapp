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
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-6xl mx-auto">
          <SearchBar
            className="max-w-3xl"
            initialCity={normalizedSearchParams.city}
            initialStartDate={normalizedSearchParams.startDate}
            initialEndDate={normalizedSearchParams.endDate}
            initialSlot={normalizedSearchParams.slot}
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
