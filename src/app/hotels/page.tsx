import { Suspense } from 'react'
import HotelListings from '@/components/hotels/HotelListings'
import HotelListingsSkeleton from '@/components/hotels/HotelListingsSkeleton'
import SearchBar from '@/components/hotels/SearchBar'

export default function HotelsPage({ searchParams }: { searchParams: Record<string, string> }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-6xl mx-auto">
          <SearchBar className="max-w-3xl" />
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Suspense fallback={<HotelListingsSkeleton />}>
          <HotelListings searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  )
}
