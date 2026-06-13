import Image from 'next/image'
import Link from 'next/link'
import { headers } from 'next/headers'

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

export default async function HotelListings({ searchParams }: { searchParams: Record<string, string> }) {
  const { hotels } = await fetchHotels(searchParams)

  if (!hotels || hotels.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-5xl mb-4">🔍</div>
        <h3 className="text-xl font-semibold text-gray-800 mb-2">No hotels found</h3>
        <p className="text-gray-500 mb-6">Try searching for a different city or adjust your dates</p>
        <Link href="/" className="bg-indigo-600 text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-indigo-700">Back to home</Link>
      </div>
    )
  }

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
}

  const hotelLinkQuery = new URLSearchParams(searchParams).toString()
  const slotLabel = searchParams.slot === 'H6'
    ? '6-hour slot'
    : searchParams.slot === 'H12'
      ? '12-hour slot'
      : searchParams.slot === 'FULLDAY'
        ? 'Full day'
        : '3-hour slot'

  return (
    <div>
      <p className="text-sm text-gray-500 mb-6">{hotels.length} hotel{hotels.length !== 1 ? 's' : ''} found{searchParams.city ? ` in ${searchParams.city}` : ''}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {(hotels as HotelCardType[]).map((hotel) => (
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
              <p className="text-sm text-gray-500 mb-2">{hotel.city}, {hotel.state}</p>
              {hotel.avgRating > 0 && <StarRating rating={hotel.avgRating} />}
              <div className="mt-3 flex items-baseline justify-between">
                {hotel.selectedSlotPrice && <span className="text-indigo-600 font-semibold">₹{hotel.selectedSlotPrice}<span className="text-xs text-gray-400 font-normal"> {slotLabel}</span></span>}
                {hotel.priceFullDay && <span className="text-gray-500 text-sm">₹{hotel.priceFullDay} full day</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
