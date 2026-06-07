import { notFound } from 'next/navigation'
import Image from 'next/image'
import type { HotelImage, Room } from '@prisma/client'
import SlotPicker from '@/components/hotels/SlotPicker'
import ReviewList from '@/components/hotels/ReviewList'
import RestaurantMenu from '@/components/hotels/RestaurantMenu'

async function getHotel(id: string) {
  const res = await fetch(`/api/hotels/${id}`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}

export default async function HotelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const hotel = await getHotel(id)
  if (!hotel) notFound()

  const avgRating = hotel.avgRating || 0

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-black">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-1 h-72 md:h-96 overflow-hidden">
          {hotel.images.slice(0, 3).map((img: HotelImage, i: number) => (
            <div key={img.id} className={`relative overflow-hidden ${i === 0 ? 'md:col-span-1 row-span-2' : ''}`}>
              <Image src={img.url} alt={img.caption || hotel.name} fill style={{ objectFit: 'cover' }} className="transition-transform duration-300 hover:scale-105" />
            </div>
          ))}
          {hotel.images.length === 0 && (
            <div className="w-full h-full bg-gray-200 flex items-center justify-center col-span-2 text-6xl">🏨</div>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{hotel.name}</h1>
            <p className="text-gray-500 mt-1">{hotel.address}, {hotel.city}, {hotel.state}</p>
            <div className="flex flex-wrap items-center gap-4 mt-3">
              {avgRating > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-yellow-400">{'★'.repeat(Math.round(avgRating))}</span>
                  <span className="font-semibold">{avgRating.toFixed(1)}</span>
                  <span className="text-gray-400 text-sm">({hotel._count.reviews} reviews)</span>
                </div>
              )}
              <div className="text-sm text-gray-500">
                Check-in: <strong>{hotel.checkInTime}</strong> · Check-out: <strong>{hotel.checkOutTime}</strong>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-semibold mb-3">About this property</h2>
            <p className="text-gray-600 leading-relaxed">{hotel.description}</p>
          </div>

          {hotel.amenities.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold mb-3">Amenities</h2>
              <div className="flex flex-wrap gap-2">
                {hotel.amenities.map((a: string) => (
                  <span key={a} className="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-full text-sm">{a}</span>
                ))}
              </div>
            </div>
          )}

          <div>
            <h2 className="text-xl font-semibold mb-4">Available rooms</h2>
            {hotel.rooms.map((room: Room & { amenities: string[]; _count: { slots: number } }) => (
              <div key={room.id} className="bg-white rounded-2xl border border-gray-100 p-6 mb-4">
                <div className="flex justify-between items-start mb-3 gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900">{room.name}</h3>
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{room.type}</span>
                    </div>
                    <p className="text-sm text-gray-500">{room.description} · Max {room.maxOccupancy} guests</p>
                  </div>
                  <div className="text-right">
                    <p className="text-indigo-600 font-bold">₹{room.pricePerHour}<span className="text-xs text-gray-400 font-normal">/hr</span></p>
                    <p className="text-gray-500 text-sm">₹{room.priceFullDay}/day</p>
                  </div>
                </div>
                {room.amenities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-4">
                    {room.amenities.map((a: string) => (
                      <span key={a} className="text-xs text-gray-500 bg-gray-50 px-2 py-1 rounded">{a}</span>
                    ))}
                  </div>
                )}
                <SlotPicker roomId={room.id} pricePerHour={room.pricePerHour} priceFullDay={room.priceFullDay} hotelId={hotel.id} />
              </div>
            ))}
          </div>

          {hotel.reviews.length > 0 && <ReviewList reviews={hotel.reviews} avgRating={avgRating} />}

          {hotel.restaurant && <RestaurantMenu restaurant={hotel.restaurant} />}
        </div>

        <div className="hidden lg:block">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 sticky top-8">
            <p className="text-2xl font-bold text-indigo-600">₹{hotel.rooms[0]?.pricePerHour || '–'}<span className="text-sm text-gray-400 font-normal">/hr</span></p>
            <p className="text-gray-500 text-sm mb-4">Starting price · scroll down to choose a room</p>
            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex justify-between"><span>Check-in</span><span className="font-medium">{hotel.checkInTime}</span></div>
              <div className="flex justify-between"><span>Check-out</span><span className="font-medium">{hotel.checkOutTime}</span></div>
              <div className="flex justify-between"><span>Owner</span><span className="font-medium">{hotel.owner.name}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
