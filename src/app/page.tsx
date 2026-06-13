import Image from 'next/image'
import Link from 'next/link'
import SearchBar from '@/components/hotels/SearchBar'

const POPULAR_CITIES = [
  {
    name: 'Mumbai',
    image: 'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?auto=format&fit=crop&w=900&q=80',
    alt: 'Gateway of India and Mumbai waterfront',
  },
  {
    name: 'Delhi',
    image: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=900&q=80',
    alt: 'India Gate in Delhi',
  },
  {
    name: 'Bangalore',
    image: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=900&q=80',
    alt: 'Bangalore city skyline',
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 text-white py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Find your perfect stay</h1>
          <p className="text-indigo-200 text-lg mb-10">Book by the hour — 3hrs, 6hrs, 12hrs or full day</p>
          <SearchBar />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-semibold text-gray-900 mb-8">Popular destinations</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {POPULAR_CITIES.map(city => (
            <Link
              key={city.name}
              href={`/hotels?city=${encodeURIComponent(city.name)}`}
              className="group relative rounded-2xl overflow-hidden aspect-[4/3] cursor-pointer"
            >
              <Image
                src={city.image}
                alt={city.alt}
                fill
                sizes="(min-width: 768px) 33vw, 100vw"
                style={{ objectFit: 'cover' }}
                className="group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <span className="absolute bottom-4 left-4 text-white font-semibold text-lg">{city.name}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
